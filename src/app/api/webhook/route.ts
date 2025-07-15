import { NextResponse } from "next/server";
import { supabase } from "@/utils/supabase";
import { sendActionButtons, sendTextMessage } from "@/utils/whatsapp";

// Validação do Webhook do WhatsApp
const verifyWebhook = (req: Request) => {
  const url = new URL(req.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  if (mode === "subscribe" && token === process.env.WHATSAPP_WEBHOOK_TOKEN) {
    return new Response(challenge, { status: 200 });
  }
  return new Response("Verification failed", { status: 403 });
};

const isValidSiteRequest = (txt: string) =>
  ["site", "página", "web", "portfolio", "loja"].some(k =>
    txt.toLowerCase().includes(k)
  );

export async function POST(req: Request) {
  try {
    // Verificar se é uma requisição de validação do webhook
    if (req.method === "GET") {
      return verifyWebhook(req);
    }

    // Validar payload do webhook
    const body = await req.json();
    if (!body.object || body.object !== "whatsapp_business_account") {
      return NextResponse.json(
        { error: "Invalid webhook object" },
        { status: 400 }
      );
    }

    console.log("[WEBHOOK] 🌐 Raw body:", JSON.stringify(body, null, 2));

    const entry = body.entry?.[0];
    if (!entry) {
      console.log("[WEBHOOK] ⚠️ No entry found");
      return NextResponse.json({}, { status: 200 });
    }

    const msg = entry.changes?.[0]?.value?.messages?.[0];
    if (!msg) {
      console.log("[WEBHOOK] ⚠️ No message found");
      return NextResponse.json({}, { status: 200 });
    }

    // Validar número de telefone
    const userPhone = msg.from;
    if (!userPhone || typeof userPhone !== "string") {
      return NextResponse.json(
        { error: "Invalid phone number" },
        { status: 400 }
      );
    }

    console.log(`\n[WEBHOOK] 📞 From: ${userPhone}`);
    console.log("[WEBHOOK] ✉️ Message payload:", msg);

    /* ──────── 1) RETRIEVE OR CREATE SESSION ──────── */
    const { data: session, error: sessionError } = await supabase
      .from("sessions")
      .select("*")
      .eq("user_phone", userPhone)
      .maybeSingle();

    if (sessionError) {
      console.error("[WEBHOOK] 🔴 Session fetch error:", sessionError);
      return NextResponse.json(
        { error: "Database error" },
        { status: 500 }
      );
    }

    let userSession = session;

    // Criar nova sessão se não existir
    if (!userSession) {
      console.log("[WEBHOOK] ➕ Creating new session for", userPhone);
      const { data: newSession, error: createError } = await supabase
        .from("sessions")
        .upsert({
          user_phone: userPhone,
          action: null,
          step: "start",
          invalidsent: false,
        })
        .select()
        .single();

      if (createError) {
        console.error("[WEBHOOK] 🔴 Session create error:", createError);
        return NextResponse.json(
          { error: "Failed to create session" },
          { status: 500 }
        );
      }

      userSession = newSession;
      await sendTextMessage(userPhone, "👋 Olá! Deseja gerar um site agora?");
      await sendActionButtons(userPhone, ["gerar_site", "sair"]);
      return NextResponse.json({}, { status: 200 });
    }

    /* ──────── 2) HANDLE INTERACTIVE BUTTONS ──────── */
    if (msg.interactive) {
      const buttonId = msg.interactive.button_reply?.id;
      if (!buttonId) {
        return NextResponse.json(
          { error: "Invalid button ID" },
          { status: 400 }
        );
      }

      const validButtons = ["gerar_site", "editar_site", "sair"];
      if (!validButtons.includes(buttonId)) {
        return NextResponse.json(
          { error: "Invalid button action" },
          { status: 400 }
        );
      }

      console.log("[WEBHOOK] 🔘 Button pressed:", buttonId);

      if (buttonId === "sair") {
        await sendTextMessage(userPhone, "Tudo bem, até mais! 👋");
        await supabase
          .from("sessions")
          .delete()
          .eq("user_phone", userPhone);
        return NextResponse.json({}, { status: 200 });
      }

      const action = buttonId === "editar_site" ? "editar" : "gerar";
      const { error: updateError } = await supabase
        .from("sessions")
        .update({ 
          action, 
          step: "aguardando_prompt", 
          invalidsent: false 
        })
        .eq("user_phone", userPhone);

      if (updateError) {
        console.error("[WEBHOOK] 🔴 Update session error:", updateError);
        return NextResponse.json(
          { error: "Failed to update session" },
          { status: 500 }
        );
      }

      await sendTextMessage(
        userPhone,
        action === "editar"
          ? "✏️ O que deseja editar no seu site?"
          : "✏️ Me diga o que você quer no seu site. Ex: 'Um site para uma loja de roupas.'"
      );
      return NextResponse.json({}, { status: 200 });
    }

    /* ──────── 3) HANDLE TEXT MESSAGES ──────── */
    if (msg.type !== "text") {
      await sendTextMessage(
        userPhone,
        "❌ Eu só entendo mensagens de texto no momento."
      );
      return NextResponse.json({}, { status: 200 });
    }

    const rawText = msg.text?.body;
    if (!rawText || typeof rawText !== "string") {
      return NextResponse.json(
        { error: "Invalid message text" },
        { status: 400 }
      );
    }

    console.log("[WEBHOOK] 🗒️ Raw text:", rawText);
    console.log("[WEBHOOK] 🗂️ Current session:", userSession);

    // Usuário enviou texto sem ação definida
    if (!userSession.action || userSession.step === "start") {
      console.log("[WEBHOOK] ℹ️ No action yet - prompting user");
      await sendTextMessage(userPhone, "👋 Deseja gerar um site agora?");
      await sendActionButtons(userPhone, ["gerar_site", "sair"]);
      return NextResponse.json({}, { status: 200 });
    }

    // Validação de prompt para site
    if (!isValidSiteRequest(rawText)) {
      if (!userSession.invalidsent) {
        console.log("[WEBHOOK] ❌ Invalid site request - sending warning");
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

    /* ──────── 4) CREATE REQUEST ROW ──────── */
    console.log("[WEBHOOK] ➡️ Creating request row...");

    // Buscar project_id para edições
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

    const { data: reqRow, error: reqError } = await supabase
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

    if (reqError) {
      console.error("[WEBHOOK] 🔴 Insert request error:", reqError);
      return NextResponse.json(
        { error: "Failed to create request" },
        { status: 500 }
      );
    }

    console.log("[WEBHOOK] ✅ Request row created:", reqRow);

    /* ──────── 5) UPDATE SESSION ──────── */
    const { error: sessionUpdateError } = await supabase
      .from("sessions")
      .update({ 
        step: "processando", 
        invalidsent: false 
      })
      .eq("user_phone", userPhone);

    if (sessionUpdateError) {
      console.error("[WEBHOOK] 🔴 Update session error:", sessionUpdateError);
    }

    /* ──────── 6) SEND CONFIRMATION ──────── */
    await sendTextMessage(
      userPhone,
      "✅ Pedido recebido! Estamos gerando seu site..."
    );

    /* ──────── 7) TRIGGER DEPLOY ──────── */
    console.log("[WEBHOOK] 🚀 Triggering deploy for request", reqRow.id);
    try {
      const deployUrl = new URL("/api/deploy", process.env.BASE_URL).toString();
      await fetch(deployUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: reqRow.id }),
      });
    } catch (deployError) {
      console.error("[WEBHOOK] 🔴 Deploy trigger error:", deployError);
      await sendTextMessage(
        userPhone,
        "❌ Ocorreu um erro ao iniciar a geração do seu site. Por favor, tente novamente."
      );
    }

    return NextResponse.json({ status: "processing" });

  } catch (error) {
    console.error("[WEBHOOK] 🔴 Uncaught error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function GET(req: Request) {
  return verifyWebhook(req);
}