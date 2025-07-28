import { NextResponse } from "next/server";
import { supabase } from "@/utils/supabase";
import { sendActionButtons, sendTextMessage } from "@/utils/whatsapp";
import { getSession, updateSession, clearSession, validateTransition } from "@/utils/session";
import { validateSitePrompt } from "@/utils/promptValidator";

// 1. Validação do Webhook (GET) (mantido igual)
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

// 2. Processamento de Mensagens (POST) - Versão Refatorada
export async function POST(request: Request) {
  try {
    console.log("[WEBHOOK] 📨 Incoming message");
    const body = await request.json();

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

    // 3. Gerenciamento de Sessão Refatorado
    const currentSession = await getSession(userPhone);

    // Processamento condicional baseado no estado
    if (currentSession.step === "aguardando_prompt" && message.type === "text") {
      return await processSiteCreation(message, currentSession);
    }

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

    // Resposta para tipos não suportados
    await sendTextMessage(
      userPhone,
      "⚠️ Eu só respondo a mensagens de texto ou botões no momento."
    );
    return NextResponse.json({}, { status: 200 });

  } catch (error) {
    console.error("[WEBHOOK] 🔴 Critical error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// Handlers Atualizados
async function handleTextMessage(message: any, session: any) {
  const userPhone = session.user_phone;
  const text = message.text?.body || "";

  console.log(`[WEBHOOK] 📝 Text message: ${text.slice(0, 50)}...`);

  if (!session.action || session.step === "start" || 
     (session.step !== "aguardando_prompt" && session.step !== "processando")) {
    await updateSession(userPhone, {
      step: "start",
      action: null
    });
    await sendTextMessage(userPhone, "👋 Olá! Como posso ajudar?");
    await sendActionButtons(userPhone, ["gerar_site", "sair"]);
    return NextResponse.json({}, { status: 200 });
  }

  return NextResponse.json({}, { status: 200 });
}

async function processSiteCreation(message: any, session: any) {
  const userPhone = session.user_phone;
  const text = message.text?.body || "";
  
  // Validação melhorada de prompt
  const validation = validateSitePrompt(text);
  
  if (!validation.isValid) {
    if (!session.invalidsent) {
      await sendTextMessage(
        userPhone,
        `❌ ${validation.reason}${validation.suggestedPrompt ? `\n\nQue tal: "${validation.suggestedPrompt}"` : ''}`
      );
      
      await updateSession(userPhone, {
        invalidsent: true,
        metadata: {
          ...(session.metadata || {}),
          lastInvalidPrompt: text
        }
      });
    }
    return NextResponse.json({}, { status: 200 });
  }

  try {
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

    if (reqError) throw reqError;

    // Atualização segura da sessão
    await updateSession(userPhone, {
      step: "processando",
      metadata: {
        lastPrompt: text,
        requestId: request.id
      }
    });

    await sendTextMessage(userPhone, "✅ Pedido recebido! Estamos gerando seu site...");

    // Disparar deploy com tratamento de erro
    try {
      await fetch(`${process.env.BASE_URL}/api/deploy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: request.id }),
      });
    } catch (err) {
      console.error("[WEBHOOK] 🔴 Deploy error:", err);
      await updateSession(userPhone, {
        step: "erro",
        metadata: {
          error: "deploy_failed"
        }
      });
      await sendTextMessage(userPhone, "❌ Falha ao iniciar a geração do site. Tente novamente.");
    }

    return NextResponse.json({ status: "processing" });

  } catch (error) {
    console.error("[WEBHOOK] 🔴 Site creation error:", error);
    await updateSession(userPhone, {
      step: "erro"
    });
    await sendTextMessage(userPhone, "❌ Ocorreu um erro ao processar sua solicitação.");
    return NextResponse.json({ error: "Processing failed" }, { status: 500 });
  }
}

async function handleButtonReply(button: any, session: any) {
  const userPhone = session.user_phone;
  console.log(`[WEBHOOK] 🔘 Button pressed: ${button.id}`);

  try {
    switch (button.id) {
      case "sair":
        await clearSession(userPhone);
        await sendTextMessage(userPhone, "👋 Até logo!");
        break;

      case "gerar_site":
      case "editar_site":
        const action = button.id === "editar_site" ? "editar" : "gerar";
        
        if (!validateTransition(session.step, "aguardando_prompt")) {
          throw new Error(`Invalid transition from ${session.step} to aguardando_prompt`);
        }

        await updateSession(userPhone, {
          action,
          step: "aguardando_prompt",
          invalidsent: false
        });
        
        await sendTextMessage(
          userPhone,
          action === "editar" 
            ? "✏️ O que deseja editar no seu site?" 
            : "📝 Descreva seu site (ex: 'Site para minha loja de roupas')"
        );
        break;
    }

    return NextResponse.json({}, { status: 200 });

  } catch (error) {
    console.error("[WEBHOOK] 🔴 Button handler error:", error);
    await updateSession(userPhone, {
      step: "erro"
    });
    await sendTextMessage(userPhone, "❌ Ocorreu um erro ao processar sua ação.");
    return NextResponse.json({ error: "Button processing failed" }, { status: 500 });
  }
}

// Função auxiliar mantida
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