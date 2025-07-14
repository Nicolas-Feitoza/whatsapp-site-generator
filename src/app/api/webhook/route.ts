import { NextResponse } from "next/server";
import { supabase } from "@/utils/supabase";
import { sendActionButtons, sendTextMessage } from "@/utils/whatsapp";

const isValidSiteRequest = (txt: string) =>
  ["site", "página", "web", "portfolio", "loja"].some(k =>
    txt.toLowerCase().includes(k)
  );

export async function POST(req: Request) {
  const body = await req.json();
  const entry = body.entry?.[0];
  const msg = entry?.changes?.[0]?.value?.messages?.[0];
  if (!msg) return NextResponse.json({}, { status: 200 });

  const userPhone = msg.from as string;

  // Recuperar ou criar sessão
  const { data: session } = await supabase
    .from("sessions")
    .select("*")
    .eq("user_phone", userPhone)
    .single();

  let userSession = session;

  if (!userSession) {
    const { data: newSession } = await supabase
      .from("sessions")
      .upsert({
        user_phone: userPhone,
        action: null,
        step: "start",
        invalidSent: false,
      })
      .select()
      .single();
    userSession = newSession;

    await sendTextMessage(userPhone, "👋 Olá! Deseja gerar um site agora?");
    await sendActionButtons(userPhone, ["gerar_site", "sair"]);
    return NextResponse.json({}, { status: 200 });
  }

  // Botão interativo
  if (msg.interactive) {
    const id = msg.interactive.button_reply.id as
      | "gerar_site"
      | "editar_site"
      | "sair";

    if (id === "sair") {
      await sendTextMessage(userPhone, "Tudo bem, até mais! 👋");
      await supabase.from("sessions").delete().eq("user_phone", userPhone);
      return NextResponse.json({}, { status: 200 });
    }

    const action = id === "editar_site" ? "editar" : "gerar";

    await supabase
      .from("sessions")
      .update({ action, step: "aguardando_prompt", invalidSent: false })
      .eq("user_phone", userPhone);

    await sendTextMessage(
      userPhone,
      action === "editar"
        ? "✏️ O que deseja editar no seu site?"
        : "✏️ Me diga o que você quer no seu site. Ex: 'Um site para uma loja de roupas.'"
    );
    return NextResponse.json({}, { status: 200 });
  }

  // Texto digitado
  const rawText = msg.text?.body || "";

  // Sem ação definida (usuário digitou sem clicar antes)
  if (!userSession.action || userSession.step === "start") {
    await sendTextMessage(userPhone, "👋 Deseja gerar um site agora?");
    await sendActionButtons(userPhone, ["gerar_site", "sair"]);
    return NextResponse.json({}, { status: 200 });
  }

  if (!isValidSiteRequest(rawText)) {
    if (!userSession.invalidSent) {
      await sendTextMessage(
        userPhone,
        '❌ Eu só posso criar sites! Diga algo como: "Quero um site para minha loja de roupas".'
      );
      await supabase
        .from("sessions")
        .update({ invalidSent: true })
        .eq("user_phone", userPhone);
    }
    return NextResponse.json({}, { status: 200 });
  }

  // Criar request
  const { data: reqRow } = await supabase
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

  // Atualiza estado da sessão
  await supabase
    .from("sessions")
    .update({ step: "processando", invalidSent: false })
    .eq("user_phone", userPhone);

  await sendTextMessage(
    userPhone,
    "✅ Pedido recebido! Deseja **gerar** um novo site ou **editar** o anterior?"
  );
  await sendActionButtons(userPhone, ["gerar_site", "editar_site", "sair"]);

  // Chamar deploy
  fetch(`${process.env.BASE_URL}/api/deploy`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: reqRow.id }),
  });

  return NextResponse.json({ status: "processing" });
}
