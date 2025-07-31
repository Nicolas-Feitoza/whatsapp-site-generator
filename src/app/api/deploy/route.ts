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
    simple: 8 * 60 * 1000,    // 8 minutes
    complex: 15 * 60 * 1000,  // 15 minutes
    default: 10 * 60 * 1000   // 10 minutes
  },
  maxRetries: 2,              // Reduced to 2 retries
  retryDelay: (attempt: number) => 
    Math.min(attempt * 15000, 45000) // Slower backoff (15s, 30s, 45s)
};

// Tipos de complexidade
type Complexity = 'simple' | 'complex';

export async function POST(request: Request) {
  const { id } = await request.json();
  
  try {
    // 1. Buscar request no Supabase
    console.log(`[DEPLOY] Buscando solicitação no banco`);
    const { data: siteRequest } = await supabase
      .from("requests")
      .select("*")
      .eq("id", id)
      .single();

    if (!siteRequest) throw new Error("Request não encontrado");

    // 2. Gerar template
    console.log(`[DEPLOY] Gerando template`);
    const template = await withRetry(
      async () => generateTemplate(siteRequest.prompt),
      DEPLOYMENT_TIMEOUTS.maxRetries,
      DEPLOYMENT_TIMEOUTS.retryDelay,
      "Template Generation"
    );

    // 3. Fazer deploy
    console.log(`[DEPLOY] Enviando para Vercel`);
    const url = await deployOnVercel(template, siteRequest.user_phone);

    // 4. Capturar thumbnail (aguardar 15s)
    console.log(`[DEPLOY] Capturando thumbnail`);
    let thumbnailUrl = 'https://via.placeholder.com/1280x720.png?text=Site+Preview';
    try {
      await new Promise(resolve => setTimeout(resolve, 15000));
      thumbnailUrl = await captureThumbnail(url);
    } catch (e) {
      console.error("Erro na thumbnail:", e);
    }

    // 5. Atualizar status
    console.log(`[DEPLOY] Atualizando banco`);
    await supabase
      .from("requests")
      .update({ 
        status: "completed",
        vercel_url: url,
        thumbnail_url: thumbnailUrl,
        updated_at: new Date().toISOString()
      })
      .eq("id", id);

    // 6. Notificar usuário
    console.log(`[DEPLOY] Notificando usuário`);
    await sendTextMessage(
      siteRequest.user_phone,
      `✅ Site pronto!\n${url}`
    );
    
    // Enviar preview
    console.log(`[DEPLOY] Enviando preview`);
    await sendImageMessage(siteRequest.user_phone, thumbnailUrl);

    return NextResponse.json({ success: true });

  } catch (error: unknown) {
    const message =
      error instanceof Error
        ? error.message
        : typeof error === 'string'
          ? error
          : JSON.stringify(error);
  
    await supabase
      .from("requests")
      .update({ 
        status: "failed",
        error: message.slice(0, 500),
        updated_at: new Date().toISOString()
      })
      .eq("id", id);
  
    return NextResponse.json(
      { error: message },
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