import { NextResponse } from "next/server";
import { supabase } from "@/utils/supabase";
import { sendActionButtons, sendTextMessage } from "@/utils/whatsapp";

const isValidSiteRequest = (txt: string) =>
  ["site", "página", "web", "portfolio", "loja"]
    .some(k => txt.toLowerCase().includes(k));

export async function POST(req: Request) {
  const body = await req.json();
  const entry = body.entry?.[0];
  const msg = entry?.changes?.[0]?.value?.messages?.[0];
  if (!msg) return NextResponse.json({}, { status: 200 });

  const userPhone = msg.from as string;

  /* ---------- 1) BOAS‑VINDAS ------------------------- */
  const { data: session0 } = await supabase
    .from("sessions")
    .select("*")
    .eq("user_phone", userPhone)
    .single();

  if (!session0) {
    await sendTextMessage(userPhone, "👋 Olá! Deseja gerar um site agora?");
    await sendActionButtons(userPhone, ["gerar_site", "sair"]);
    return NextResponse.json({}, { status: 200 });
  }

  /* ---------- 2) BOTÕES ----------------------------- */
  if (msg.interactive) {
    const id = msg.interactive.button_reply.id as "gerar_site" | "editar_site" | "sair";

    if (id === "sair") {
      await sendTextMessage(userPhone, "Tudo bem, até mais! 👋");
      await supabase.from("sessions").delete().eq("user_phone", userPhone);
      return NextResponse.json({}, { status: 200 });
    }

    const action = id === "editar_site" ? "editar" : "gerar";
    await supabase.from("sessions")
      .upsert({ user_phone: userPhone, action, invalidSent: false });

    await sendTextMessage(
      userPhone,
      action === "editar"
        ? "✏️ O que deseja editar?"
        : "✏️ Envie o texto do site que deseja gerar."
    );
    return NextResponse.json({}, { status: 200 });
  }

  /* ---------- 3) TEXTO ------------------------------ */
  const rawText = msg.text?.body || "";
  const { data: session } = await supabase
    .from("sessions")
    .select("action, invalidSent")
    .eq("user_phone", userPhone)
    .single();

  if (!session) return NextResponse.json({}, { status: 200 }); // segurança

  if (!isValidSiteRequest(rawText)) {
    if (!session.invalidSent) {
      await sendTextMessage(
        userPhone,
        '❌ Eu só posso criar sites! Tente algo como: "Quero um site para minha loja de roupas".'
      );
      await supabase.from("sessions")
        .update({ invalidSent: true })
        .eq("user_phone", userPhone);
    }
    return NextResponse.json({}, { status: 200 });
  }

  /* ---------- 4) INSERE REQUEST ---------------------- */
  const { data: reqRow } = await supabase
    .from("requests")
    .insert([{
      user_phone: userPhone,
      prompt: rawText,
      status: "pending",
      message_id: msg.id,
    }])
    .select()
    .single();

  await sendTextMessage(
    userPhone,
    "✅ Pedido recebido! Deseja **gerar** um novo site ou **editar** o anterior?"
  );
  await sendActionButtons(userPhone, ["gerar_site", "editar_site", "sair"]);

  fetch(`${process.env.BASE_URL}/api/deploy`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: reqRow.id }),
  });

  return NextResponse.json({ status: "processing" });
}
