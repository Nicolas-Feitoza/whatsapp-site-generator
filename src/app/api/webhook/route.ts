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
    if (!msg) {
      console.log("[WEBHOOK] ⚠️ No message found – returning 200");
      return NextResponse.json({}, { status: 200 });
    }

    const userPhone = msg.from as string;
    console.log(`\n[WEBHOOK] 📞 From: ${userPhone}`);
    console.log("[WEBHOOK] ✉️ Message payload:", msg);

    /* ───────────────── 1) RETRIEVE OR CREATE SESSION ───────────────── */
    const { data: session, error: fetchSessionErr } = await supabase
      .from("sessions")
      .select("*")
      .eq("user_phone", userPhone)
      .single();

    if (fetchSessionErr) {
      console.error("[WEBHOOK] 🔴 Session fetch error:", fetchSessionErr);
    }

    let userSession = session;

    // If session does not exist, create it and send welcome message
    if (!userSession) {
      console.log("[WEBHOOK] ➕ Creating new session for", userPhone);
      const { data: newSession, error: createSessionErr } = await supabase
        .from("sessions")
        .upsert({
          user_phone: userPhone,
          action: null,
          step: "start",
          invalidSent: false,
        })
        .select()
        .single();

      if (createSessionErr) {
        console.error("[WEBHOOK] 🔴 Session create error:", createSessionErr);
      } else {
        console.log("[WEBHOOK] ✅ Session created:", newSession);
      }

      userSession = newSession;

      await sendTextMessage(userPhone, "👋 Olá! Deseja gerar um site agora?");
      await sendActionButtons(userPhone, ["gerar_site", "sair"]);
      return NextResponse.json({}, { status: 200 });
    }

    /* ───────────────── 2) HANDLE INTERACTIVE BUTTONS ───────────────── */
    if (msg.interactive) {
      const id = msg.interactive.button_reply.id as
        | "gerar_site"
        | "editar_site"
        | "sair";

      console.log("[WEBHOOK] 🔘 Button pressed:", id);

      if (id === "sair") {
        await sendTextMessage(userPhone, "Tudo bem, até mais! 👋");
        const { error: delErr } = await supabase
          .from("sessions")
          .delete()
          .eq("user_phone", userPhone);
        if (delErr) console.error("[WEBHOOK] 🔴 Delete session error:", delErr);
        return NextResponse.json({}, { status: 200 });
      }

      const action = id === "editar_site" ? "editar" : "gerar";
      console.log(`[WEBHOOK] 📝 Setting action='${action}' and step='aguardando_prompt'`);

      const { error: updErr } = await supabase
        .from("sessions")
        .update({ action, step: "aguardando_prompt", invalidSent: false })
        .eq("user_phone", userPhone);
      if (updErr) console.error("[WEBHOOK] 🔴 Update session error:", updErr);

      await sendTextMessage(
        userPhone,
        action === "editar"
          ? "✏️ O que deseja editar no seu site?"
          : "✏️ Me diga o que você quer no seu site. Ex: 'Um site para uma loja de roupas.'"
      );
      return NextResponse.json({}, { status: 200 });
    }

    /* ───────────────── 3) HANDLE PLAIN TEXT ───────────────── */
    const rawText = msg.text?.body || "";
    console.log("[WEBHOOK] 🗒️ Raw text:", rawText);
    console.log("[WEBHOOK] 🗂️ Current session:", userSession);

    // User typed without first choosing an action
    if (!userSession.action || userSession.step === "start") {
      console.log("[WEBHOOK] ℹ️ No action yet – prompting user");
      await sendTextMessage(userPhone, "👋 Deseja gerar um site agora?");
      await sendActionButtons(userPhone, ["gerar_site", "sair"]);
      return NextResponse.json({}, { status: 200 });
    }

    // Invalid request guard
    if (!isValidSiteRequest(rawText)) {
      if (!userSession.invalidSent) {
        console.log("[WEBHOOK] ❌ Invalid site request – sending warning");
        await sendTextMessage(
          userPhone,
          '❌ Eu só posso criar sites! Diga algo como: "Quero um site para minha loja de roupas".'
        );
        const { error: invErr } = await supabase
          .from("sessions")
          .update({ invalidSent: true })
          .eq("user_phone", userPhone);
        if (invErr) console.error("[WEBHOOK] 🔴 Update invalidSent error:", invErr);
      }
      return NextResponse.json({}, { status: 200 });
    }

    /* ───────────────── 4) CREATE REQUEST ROW ───────────────── */
    console.log("[WEBHOOK] ➡️ Creating request row…");
    const { data: reqRow, error: reqErr } = await supabase
      .from("requests")
      .insert([
        {
          user_phone: userPhone,
          prompt: rawText,
          status: "pending",
          message_id: msg.id,
        },
      ])
      .select()
      .single();
    if (reqErr) {
      console.error("[WEBHOOK] 🔴 Insert request error:", reqErr);
      return NextResponse.json({ error: reqErr.message }, { status: 500 });
    }
    console.log("[WEBHOOK] ✅ Request row created:", reqRow);

    /* ───────────────── 5) UPDATE SESSION STATE ───────────────── */
    const { error: sessUpdErr } = await supabase
      .from("sessions")
      .update({ step: "processando", invalidSent: false })
      .eq("user_phone", userPhone);
    if (sessUpdErr) console.error("[WEBHOOK] 🔴 Update session step error:", sessUpdErr);

    /* ───────────────── 6) SEND CONFIRMATION & START DEPLOY ───────────────── */
    await sendTextMessage(
      userPhone,
      "✅ Pedido recebido! Deseja **gerar** um novo site ou **editar** o anterior?"
    );
    await sendActionButtons(userPhone, ["gerar_site", "editar_site", "sair"]);

    // Trigger deploy API (fire & forget)
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
