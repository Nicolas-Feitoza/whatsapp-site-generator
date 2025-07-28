import { NextResponse } from "next/server";
import pTimeout from "p-timeout";
import { supabase } from "@/utils/supabase";
import { generateTemplate } from "@/utils/aiClient";
import { deployOnVercel } from "@/utils/vercelDeploy";
import { captureThumbnail } from "@/utils/thumbnail";
import { sendTextMessage, sendImageMessage } from "@/utils/whatsapp";

// Configurações de timeout ajustáveis
const DEPLOYMENT_TIMEOUTS = {
  // Tempos base (em ms)
  templateGeneration: {
    simple: 3 * 60 * 1000,    // 3 min para sites simples
    complex: 10 * 60 * 1000,  // 10 min para sites complexos
    default: 5 * 60 * 1000    // 5 min padrão
  },
  vercelDeploy: {
    simple: 3 * 60 * 1000,    // 3 min
    complex: 8 * 60 * 1000,   // 8 min
    default: 4 * 60 * 1000    // 4 min padrão
  },
  maxRetries: 3,              // Máximo de tentativas
  retryDelay: 30 * 1000       // 30s entre tentativas
};

// Tipos de complexidade
type Complexity = 'simple' | 'complex';

export async function POST(request: Request) {
  let requestId: string | undefined;

  try {
    const { id } = (await request.json()) as { id: string };
    requestId = id;
    console.log(`\n[DEPLOY] 🚀 Starting deploy for request id=${id}`);

    // 1) Mark request as processing
    const { error: markProcErr } = await supabase
      .from("requests")
      .update({ 
        status: "processing", 
        updated_at: new Date().toISOString(),
        attempts: (await getCurrentAttempts(id)) + 1
      })
      .eq("id", id);
    if (markProcErr) console.error("[DEPLOY] 🔴 Mark processing error:", markProcErr);

    // 2) Fetch request row
    const { data: siteRequest, error: fetchReqErr } = await supabase
      .from("requests")
      .select("*")
      .eq("id", id)
      .single();
    if (fetchReqErr) throw fetchReqErr;
    console.log("[DEPLOY] 🗂️ Request row:", siteRequest);

    // 3. Determinar complexidade
    const complexity = determineComplexity(siteRequest.prompt);
    console.log(`[DEPLOY] 🧠 Complexidade: ${complexity}`);

    // 4. Gerar template com timeout dinâmico
    console.log("[DEPLOY] 🧠 Generating template via AI…");
    const templateGenerationTimeout = DEPLOYMENT_TIMEOUTS.templateGeneration[complexity];
    
    const templateCode = await withRetry(
      () => pTimeout(
        generateTemplate(siteRequest.prompt),
        { milliseconds: templateGenerationTimeout }
      ),
      DEPLOYMENT_TIMEOUTS.maxRetries,
      DEPLOYMENT_TIMEOUTS.retryDelay
    );

    console.log("[DEPLOY] ✅ Template generated (length:", templateCode.length, ")");

    // 4) Deploy to Vercel
    console.log("[DEPLOY] 🚀 Deploying to Vercel…");
    const vercelDeployTimeout = DEPLOYMENT_TIMEOUTS.vercelDeploy[complexity];
    
    const deployed = await withRetry(
      () => pTimeout(
        deployOnVercel(templateCode, siteRequest.project_id, siteRequest.user_phone),
        { milliseconds: vercelDeployTimeout }
      ),
      DEPLOYMENT_TIMEOUTS.maxRetries,
      DEPLOYMENT_TIMEOUTS.retryDelay
    );

    const vercelUrl = deployed?.url;
    if (!deployed?.url) {
      throw new Error("Vercel deployment failed: missing URL.");
    }
    console.log("[DEPLOY] ✅ Deployed at", vercelUrl);

    // 5) Thumbnail handling
    const { data: prev, error: thumbPrevErr } = await supabase
      .from("requests") 
      .select("thumbnail_url, updated_at")
      .eq("vercel_url", vercelUrl)
      .order("updated_at", { ascending: false })
      .limit(1)
      .single();
    if (thumbPrevErr) console.error("[DEPLOY] 🔴 Thumb prev fetch error:", thumbPrevErr);

    let thumbnailUrl = prev?.thumbnail_url;
    const tooOld = prev && Date.now() - new Date(prev.updated_at).getTime() > 24 * 60 * 60_000;

    if (!thumbnailUrl || tooOld) {
      console.log("[DEPLOY] 📸 Capturando novo thumbnail...");
      try {
        thumbnailUrl = await captureThumbnail(vercelUrl);
        console.log("[DEPLOY] ✅ Thumbnail capturado:", thumbnailUrl);
      } catch (error) {
        console.error("[DEPLOY] 🔴 Erro no thumbnail:", error);
      }
    }

    // 6) Update request with projectId
    const { error: updReqErr } = await supabase
      .from("requests")
      .update({
        status: "completed",
        vercel_url: vercelUrl,
        thumbnail_url: thumbnailUrl,
        project_id: deployed.projectId, // Store projectId
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);
    if (updReqErr) console.error("[DEPLOY] 🔴 Update request error:", updReqErr);

    // 7) Notify user
    if (thumbnailUrl) {
      await sendImageMessage(siteRequest.user_phone, thumbnailUrl)
        .catch(err => console.error("[DEPLOY] 🔴 sendImageMessage error:", err));
    }

    await sendTextMessage(
      siteRequest.user_phone,
      `✅ Seu site está pronto!\n\n🌐 ${vercelUrl}\n(Link válido por 24h)`
    ).catch(err => console.error("[DEPLOY] 🔴 sendTextMessage error:", err));

    console.log("[DEPLOY] 🎉 Finished successfully");
    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error("[DEPLOY] 🔴 Caught error:", {
      message: err.message,
      stack: err.stack,
      response: err.response?.data
    });

    if (requestId) {
      await handleDeploymentError(requestId, err);
    }

    return NextResponse.json(
      { error: (err && err.message) || "Unknown error" },
      { status: 500 }
    );
  }
}

async function getCurrentAttempts(requestId: string): Promise<number> {
  const { data } = await supabase
    .from("requests")
    .select("attempts")
    .eq("id", requestId)
    .single();
  
  return data?.attempts || 0;
}

function determineComplexity(prompt: string): Complexity {
  // Heurística simples baseada no tamanho e palavras-chave
  const complexKeywords = [
    'ecommerce', 'loja online', 'dashboard', 'aplicativo', 
    'sistema', 'plataforma', 'multi', 'várias', 'complex'
  ];

  const isComplex = 
    prompt.length > 500 || 
    complexKeywords.some(kw => prompt.toLowerCase().includes(kw));

  return isComplex ? 'complex' : 'simple';
}

async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number,
  delayMs: number
): Promise<T> {
  let attempt = 0;
  let lastError: Error | null = null;

  while (attempt < maxRetries) {
    attempt++;
    try {
      return await fn();
    } catch (error) {
      // Garante que o erro seja do tipo Error
      lastError = error instanceof Error ? error : new Error(String(error));
      console.log(`[DEPLOY] 🔄 Tentativa ${attempt} falhou, tentando novamente...`);

      if (attempt < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, delayMs * attempt));
      }
    }
  }

  // Garante que lastError não seja null ao lançar
  throw lastError ?? new Error("Unknown error occurred during retry.");
}


async function handleDeploymentError(requestId: string, error: Error) {
  // Atualizar status com base no tipo de erro
  const status = error.message.includes('timeout') ? 'timeout' : 'failed';
  
  await supabase
    .from("requests")
    .update({ 
      status,
      updated_at: new Date().toISOString(),
      error: error.message.slice(0, 500) // Limitar tamanho
    })
    .eq("id", requestId);

  // Notificar usuário se possível
  const { data: row } = await supabase
    .from("requests")
    .select("user_phone")
    .eq("id", requestId)
    .single();

  if (row?.user_phone) {
    const message = status === 'timeout'
      ? "⌛ O tempo para gerar seu site expirou. Estamos tentando novamente..."
      : "❌ Ocorreu um erro ao gerar seu site. Por favor, tente novamente mais tarde.";

    await sendTextMessage(row.user_phone, message)
      .catch(e => console.error("[DEPLOY] 🔴 sendTextMessage error:", e));
  }
}