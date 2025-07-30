import { NextResponse } from "next/server";
import pTimeout from "p-timeout";
import { supabase } from "@/utils/supabase";
import { generateTemplate } from "@/utils/aiClient";
import { deployOnVercel } from "@/utils/vercelDeploy";
import { captureThumbnail } from "@/utils/thumbnail";
import { sendTextMessage, sendImageMessage } from "@/utils/whatsapp";

// Configurações de timeout ajustáveis
const DEPLOYMENT_TIMEOUTS = {
  templateGeneration: {
    simple: 10 * 60 * 1000,    // 10 min for simple sites
    complex: 20 * 60 * 1000,   // 20 min for complex sites
    default: 15 * 60 * 1000    // 15 min default
  },
  vercelDeploy: {
    simple: 5 * 60 * 1000,     // 5 min
    complex: 10 * 60 * 1000,   // 10 min
    default: 8 * 60 * 1000     // 8 min default
  },
  maxRetries: 3,               // Increased max retries
  retryDelay: (attempt: number) => 
    Math.min(attempt * 10000, 60000)        // 30s between retries
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
    console.log(`[DEPLOY] Processando request`);
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
      DEPLOYMENT_TIMEOUTS.retryDelay,
      'Template generation'
    );

    console.log("[DEPLOY] ✅ Template generated (length:", templateCode.length, ")");

    // 4) Deploy to Vercel
    console.log("[DEPLOY] 🚀 Deploying to Vercel…");
    const vercelDeployTimeout = DEPLOYMENT_TIMEOUTS.vercelDeploy[complexity];
    
    const deployed = await withRetry(
      async (attempt) => {
        try {
          const result = await pTimeout(
            deployOnVercel(templateCode, siteRequest.project_id, siteRequest.user_phone),
            { milliseconds: vercelDeployTimeout }
          );
          
          // Additional verification
          await verifyDeployment(result.url);
          return result;
        } catch (error) {
          console.error(`Deployment attempt ${attempt} failed:`, error);
          throw error;
        }
      },
      DEPLOYMENT_TIMEOUTS.maxRetries,
      DEPLOYMENT_TIMEOUTS.retryDelay,
      'Template Deployment'
    );

    const vercelUrl = deployed?.url;
    if (!vercelUrl) {
      throw new Error("Vercel deployment failed: missing URL.");
    }

    // Verify deployment is accessible
    try {
      await verifyDeployment(vercelUrl);
      console.log("[DEPLOY] ✅ Verified deployment at", vercelUrl);
    } catch (verifyError) {
      console.error("[DEPLOY] 🔴 Deployment verification failed:", verifyError);
      throw new Error("Deployed site is not accessible");
    }

    // 5) Thumbnail handling
    console.log(`[DEPLOY] Lidando com a thumbnail`);
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
    console.log("[DEPLOY] Processo finalizado");
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
    'sistema', 'plataforma', 'multi', 'várias', 'complex',
    'banco de dados', 'login', 'cadastro', 'pagamento'
  ];

  const isComplex = 
    prompt.length > 300 || 
    complexKeywords.some(kw => prompt.toLowerCase().includes(kw)) ||
    prompt.split(' ').length > 50;

  return isComplex ? 'complex' : 'simple';
}

async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  maxRetries: number,
  getDelay: (attempt: number) => number,
  operationName: string
): Promise<T> {
  let attempt = 0;
  let lastError: Error | null = null;

  while (attempt < maxRetries) {
    attempt++;
    try {
      const result = await fn(attempt);
      console.log(`[DEPLOY] ✅ ${operationName} succeeded on attempt ${attempt}`);
      return result;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      console.log(`[DEPLOY] 🔄 Attempt ${attempt} failed: ${lastError.message}`);

      if (attempt < maxRetries) {
        const delay = getDelay(attempt);
        console.log(`[DEPLOY] ⏳ Waiting ${delay}ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  console.log(`[DEPLOY] ❌ ${operationName} failed after ${maxRetries} attempts`);
  throw lastError ?? new Error(`${operationName} failed after ${maxRetries} attempts`);
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

async function verifyDeployment(url: string): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    const response = await fetch(url, { 
      signal: controller.signal 
    });
    clearTimeout(timeout);
    
    if (response.status !== 200) {
      throw new Error(`Deployment verification failed: ${response.status}`);
    }
  } catch (error) {
    clearTimeout(timeout);
    throw new Error(`Failed to verify deployment: ${error instanceof Error ? error.message : String(error)}`);
  }
}