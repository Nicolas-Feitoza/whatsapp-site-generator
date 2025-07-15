import { NextResponse } from "next/server";
import { supabase } from "@/utils/supabase";
import { sendActionButtons, sendTextMessage } from "@/utils/whatsapp";

// 1. Validação do Webhook (GET)
export async function GET(request: Request) {
  const url = new URL(request.url);
  const params = {
    mode: url.searchParams.get("hub.mode"),
    token: url.searchParams.get("hub.verify_token"),
    challenge: url.searchParams.get("hub.challenge")
  };

  console.log(`[WEBHOOK] 🔍 Verification attempt: mode=${params.mode}`);

  if (params.mode === "subscribe" && params.token === process.env.WHATSAPP_VERIFY_TOKEN) {
    console.log("[WEBHOOK] ✅ Verification successful");
    return new Response(params.challenge, { status: 200 });
  }

  console.error("[WEBHOOK] ❌ Verification failed - Invalid token or mode");
  return new Response("Verification failed", { status: 403 });
}

// 2. Processamento de Mensagens (POST)
export async function POST(request: Request) {
  try {
    console.log("[WEBHOOK] 📨 Incoming message");
    const body = await request.json();

    // Validação básica do payload
    if (!body.object || body.object !== "whatsapp_business_account") {
      console.error("[WEBHOOK] ❌ Invalid payload structure");
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
    }

    const entry = body.entry?.[0];
    if (!entry) {
      console.log("[WEBHOOK] ⚠️ Empty entry");
      return NextResponse.json({}, { status: 200 });
    }

    const message = entry.changes?.[0]?.value?.messages?.[0];
    if (!message) {
      console.log("[WEBHOOK] ⚠️ No message in payload");
      return NextResponse.json({}, { status: 200 });
    }

    const userPhone = message.from;
    if (!userPhone) {
      console.error("[WEBHOOK] ❌ Missing phone number");
      return NextResponse.json({ error: "Missing phone number" }, { status: 400 });
    }

    console.log(`[WEBHOOK] 📞 Message from: ${userPhone}`);
    console.log("[WEBHOOK] 📩 Message details:", {
      type: message.type,
      id: message.id,
      timestamp: message.timestamp
    });

    // 3. Gerenciamento de Sessão
    const { data: session, error: sessionError } = await supabase
      .from("sessions")
      .select("*")
      .eq("user_phone", userPhone)
      .maybeSingle();

    if (sessionError) {
      console.error("[WEBHOOK] 🔴 Session error:", sessionError);
      throw new Error("Database error");
    }

    let currentSession = session || {
      user_phone: userPhone,
      action: null,
      step: "start",
      invalidsent: false
    };

    // 4. Processamento por Tipo de Mensagem
    switch (message.type) {
      case "text":
        return await handleTextMessage(message, currentSession);
      
      case "interactive":
        if (message.interactive?.type === "button_reply") {
          return await handleButtonReply(message.interactive.button_reply, currentSession);
        }
        break;
    }

    // 5. Resposta padrão para tipos não suportados
    try {
      await sendTextMessage(
        userPhone,
        "⚠️ Eu só respondo a mensagens de texto ou botões no momento."
      );
    } catch (error) {
      console.error("[WEBHOOK] 🔴 Failed to send error message:", error);
    }

    return NextResponse.json({}, { status: 200 });

  } catch (error) {
    console.error("[WEBHOOK] 🔴 Critical error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// 6. Handlers Especializados
async function handleTextMessage(message: any, session: any) {
  const userPhone = message.from;
  const text = message.text?.body || "";

  console.log(`[WEBHOOK] 📝 Text message: ${text.slice(0, 50)}...`);

  // Se não houver ação definida
  if (!session.action || session.step === "start") {
    await sendTextMessage(userPhone, "👋 Olá! Como posso ajudar?");
    await sendActionButtons(userPhone, ["gerar_site", "sair"]);
    return NextResponse.json({}, { status: 200 });
  }

  // Validação de prompt para site
  const isValidRequest = ["site", "página", "web", "portfolio", "loja"]
    .some(k => text.toLowerCase().includes(k));

  if (!isValidRequest) {
    if (!session.invalidsent) {
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

  // Criar solicitação no banco de dados
  const { data: request, error: reqError } = await supabase
    .from("requests")
    .insert([{
      user_phone: userPhone,
      prompt: text,
      status: "pending",
      message_id: message.id,
      project_id: session.action === "editar" ? await getLastProjectId(userPhone) : null
    }])
    .select()
    .single();

  if (reqError) throw new Error("Failed to create request");

  // Atualizar sessão e disparar processamento
  await supabase
    .from("sessions")
    .update({ step: "processando" })
    .eq("user_phone", userPhone);

  await sendTextMessage(userPhone, "✅ Pedido recebido! Estamos gerando seu site...");

  // Disparar deploy em segundo plano
  fetch(`${process.env.BASE_URL}/api/deploy`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: request.id }),
  }).catch(err => console.error("[WEBHOOK] 🔴 Deploy error:", err));

  return NextResponse.json({ status: "processing" });
}

async function handleButtonReply(button: any, session: any) {
  const userPhone = session.user_phone;
  console.log(`[WEBHOOK] 🔘 Button pressed: ${button.id}`);

  switch (button.id) {
    case "sair":
      await supabase.from("sessions").delete().eq("user_phone", userPhone);
      await sendTextMessage(userPhone, "👋 Até logo!");
      break;

    case "gerar_site":
    case "editar_site":
      const action = button.id === "editar_site" ? "editar" : "gerar";
      await supabase
        .from("sessions")
        .update({ action, step: "aguardando_prompt" })
        .eq("user_phone", userPhone);
      
      await sendTextMessage(
        userPhone,
        action === "editar" 
          ? "✏️ O que deseja editar no seu site?" 
          : "📝 Descreva seu site (ex: 'Site para minha loja de roupas')"
      );
      break;
  }

  return NextResponse.json({}, { status: 200 });
}

// 7. Funções Auxiliares
async function getLastProjectId(userPhone: string): Promise<string | null> {
  const { data } = await supabase
    .from("requests")
    .select("project_id")
    .eq("user_phone", userPhone)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  return data?.project_id || null;
}