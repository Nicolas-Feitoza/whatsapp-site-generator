import { NextResponse } from "next/server";
import { supabase } from "@/utils/supabase";
import { sendActionButtons, sendTextMessage } from "@/utils/whatsapp";

const isValidSiteRequest = (txt: string) =>
  ["site", "página", "web", "portfolio", "loja"].some(k =>
    txt.toLowerCase().includes(k)
  );

export async function POST(req: Request) {
  try {
    const body = await req.json();
    console.log("[WEBHOOK] 🌐 Raw body:", JSON.stringify(body));

    const entry = body.entry?.[0];
    const msg = entry?.changes?.[0]?.value?.messages?.[0];
    if (!msg) return NextResponse.json({}, { status: 200 });

    const userPhone = msg.from as string;
    console.log(`\n[WEBHOOK] 📞 From: ${userPhone}`);

    // 1) Retrieve or create session
    const { data: session, error } = await supabase
      .from("sessions")
      .select("*")
      .eq("user_phone", userPhone)
      .maybeSingle();

    if (error) console.error("[WEBHOOK] 🔴 Session fetch error:", error);
    let userSession = session;

    if (!userSession) {
      const { data: newSession, error: createSessionErr } = await supabase
        .from("sessions")
        .upsert({
          user_phone: userPhone,
          action: null,
          step: "start",
          invalidsent: false,
        })
        .select()
        .single();

      if (createSessionErr) {
        console.error("[WEBHOOK] 🔴 Session create error:", createSessionErr);
      } else {
        userSession = newSession;
        await sendTextMessage(userPhone, "👋 Olá! Deseja gerar um site agora?");
        await sendActionButtons(userPhone, ["gerar_site", "sair"]);
      }
      return NextResponse.json({}, { status: 200 });
    }

    // 2) Handle interactive buttons
    if (msg.interactive) {
      const id = msg.interactive.button_reply.id as "gerar_site" | "editar_site" | "sair";
      console.log("[WEBHOOK] 🔘 Button pressed:", id);

      if (id === "sair") {
        await sendTextMessage(userPhone, "Tudo bem, até mais! 👋");
        await supabase.from("sessions").delete().eq("user_phone", userPhone);
        return NextResponse.json({}, { status: 200 });
      }

      const action = id === "editar_site" ? "editar" : "gerar";
      await supabase
        .from("sessions")
        .update({ action, step: "aguardando_prompt", invalidsent: false })
        .eq("user_phone", userPhone);

      await sendTextMessage(
        userPhone,
        action === "editar"
          ? "✏️ O que deseja editar no seu site?"
          : "✏️ Me diga o que você quer no seu site. Ex: 'Um site para uma loja de roupas.'"
      );
      return NextResponse.json({}, { status: 200 });
    }

    // 3) Handle plain text
    const rawText = msg.text?.body || "";
    console.log("[WEBHOOK] 🗒️ Raw text:", rawText);

    if (!userSession.action || userSession.step === "start") {
      await sendTextMessage(userPhone, "👋 Deseja gerar um site agora?");
      await sendActionButtons(userPhone, ["gerar_site", "sair"]);
      return NextResponse.json({}, { status: 200 });
    }

    if (!isValidSiteRequest(rawText)) {
      if (!userSession.invalidsent) {
        await sendTextMessage(
          userPhone,
          '❌ Eu só posso criar sites! Diga algo como: "Quero um site para minha loja de roupas".'
        );
        await supabase
          .from("sessions")
          .update({ invalidsent: true })
          .eq("user_phone", userPhone);
      }
      return NextResponse.json({}, { status: 200 });
    }

    // 4) Get project_id for edits
    let projectId: string | null = null;
    if (userSession.action === "editar") {
      const { data: lastRequest } = await supabase
        .from("requests")
        .select("project_id")
        .eq("user_phone", userPhone)
        .order("created_at", { ascending: false })
        .limit(1)
        .single();
        
      projectId = lastRequest?.project_id || null;
    }

    // 5) Create request row
    const { data: reqRow, error: reqErr } = await supabase
      .from("requests")
      .insert([{
        user_phone: userPhone,
        prompt: rawText,
        status: "pending",
        message_id: msg.id,
        project_id: projectId
      }])
      .select()
      .single();
    
    if (reqErr) {
      console.error("[WEBHOOK] 🔴 Insert request error:", reqErr);
      return NextResponse.json({ error: reqErr.message }, { status: 500 });
    }

    // 6) Update session
    await supabase
      .from("sessions")
      .update({ step: "processando", invalidsent: false })
      .eq("user_phone", userPhone);

    // 7) Send confirmation and trigger deploy
    await sendTextMessage(
      userPhone,
      "✅ Pedido recebido! Deseja **gerar** um novo site ou **editar** o anterior?"
    );
    await sendActionButtons(userPhone, ["gerar_site", "editar_site", "sair"]);

    console.log("[WEBHOOK] 🚀 Triggering /api/deploy for id", reqRow.id);
    fetch(`${process.env.BASE_URL}/api/deploy`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: reqRow.id }),
    }).catch(err => console.error("[WEBHOOK] 🔴 Deploy fetch error:", err));

    return NextResponse.json({ status: "processing" });
  } catch (err) {
    console.error("[WEBHOOK] 🔴 Uncaught error:", err);
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}