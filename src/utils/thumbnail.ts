import { supabase } from "./supabase";
import { createHash } from 'crypto';

// Configurações ajustáveis
const THUMBNAIL_SETTINGS = {
  defaultExpiry: 7 * 24 * 60 * 60, // 7 dias em segundos
  maxRetries: 3,
  retryDelay: 2000,
  cacheControl: 'public, max-age=604800', // 7 dias
  imageMaxSize: 5 * 1024 * 1024, // 5MB
  allowedTypes: ['image/png', 'image/jpeg', 'image/webp']
};

export async function captureThumbnail(url: string): Promise<string> {
  // 1. Verificar se já existe thumbnail para esta URL
  const existingUrl = await checkExistingThumbnail(url);
  if (existingUrl) {
    console.log('[THUMBNAIL] ♻️ Usando thumbnail existente');
    return existingUrl;
  }

  // 2. Capturar screenshot com tratamento de erros
  let imageBuffer: Buffer;
  try {
    imageBuffer = await captureScreenshotWithRetry(url);
  } catch (error) {
    console.error('[THUMBNAIL] 🔴 Falha ao capturar screenshot:', error);
    throw new Error('Falha ao capturar preview do site');
  }

  // 3. Validar imagem capturada
  validateImage(imageBuffer);

  // 4. Upload seguro para o Supabase Storage
  return uploadThumbnail(url, imageBuffer);
}

// Função auxiliar para verificar thumbnail existente
async function checkExistingThumbnail(url: string): Promise<string | null> {
  const urlHash = hashUrl(url);
  const { data: existing } = await supabase
    .storage
    .from('thumbnails')
    .list('', {
      search: `${urlHash}`,
      limit: 1
    });

  if (existing && existing.length > 0) {
    const { data: signedUrl } = await supabase
      .storage
      .from('thumbnails')
      .createSignedUrl(existing[0].name, THUMBNAIL_SETTINGS.defaultExpiry);

    return signedUrl?.signedUrl || null;
  }
  return null;
}

// Função para capturar screenshot com retry
async function captureScreenshotWithRetry(url: string, attempt = 1): Promise<Buffer> {
  const accessKey = process.env.SCREENSHOTONE_ACCESS_KEY;
  if (!accessKey) throw new Error("SCREENSHOTONE_ACCESS_KEY não configurada");

  try {
    const endpoint = buildScreenshotEndpoint(url);
    const res = await fetch(endpoint);

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`ScreenshotOne ${res.status}: ${errorText}`);
    }

    const buffer = Buffer.from(await res.arrayBuffer());
    return buffer;
  } catch (error) {
    if (attempt >= THUMBNAIL_SETTINGS.maxRetries) throw error;

    await new Promise(r => setTimeout(r, THUMBNAIL_SETTINGS.retryDelay * attempt));
    return captureScreenshotWithRetry(url, attempt + 1);
  }
}

// Construir endpoint de screenshot com parâmetros
function buildScreenshotEndpoint(url: string): string {
  const params = new URLSearchParams({
    access_key: process.env.SCREENSHOTONE_ACCESS_KEY!,
    url: encodeURIComponent(url),
    format: 'png',
    fullpage: 'false',
    width: '1280',
    height: '720',
    delay: '5',
    response_type: 'image',
    quality: '90',
    cache: 'true',
    cache_ttl: '86400' // Cache por 1 dia
  });

  return `https://api.screenshotone.com/v1/screenshot?${params.toString()}`;
}

// Validar imagem capturada
function validateImage(buffer: Buffer): void {
  // Verificar tamanho
  if (buffer.length > THUMBNAIL_SETTINGS.imageMaxSize) {
    throw new Error(`Imagem muito grande (${buffer.length} bytes)`);
  }

  // Verificar tipo (magic numbers)
  const magic = buffer.toString('hex', 0, 4);
  const validMagicNumbers = {
    png: '89504e47',
    jpeg: 'ffd8ffe0',
    jpg: 'ffd8ffe1',
    webp: '52494646'
  };

  if (!Object.values(validMagicNumbers).some(m => magic.startsWith(m))) {
    throw new Error('Formato de imagem inválido');
  }
}

// Upload seguro para o Supabase
async function uploadThumbnail(url: string, buffer: Buffer): Promise<string> {
  const urlHash = hashUrl(url);
  const fileName = `thumbs/${urlHash}.png`;

  // Upload com opções de segurança
  const { data: uploadData, error: uploadError } = await supabase
    .storage
    .from('thumbnails')
    .upload(fileName, buffer, {
      contentType: 'image/png',
      cacheControl: THUMBNAIL_SETTINGS.cacheControl,
      upsert: false // Evitar sobrescrita
    });

  if (uploadError) {
    console.error('[THUMBNAIL] 🔴 Erro no upload:', uploadError);
    throw new Error('Falha ao armazenar thumbnail');
  }

  // Criar URL assinada de longa duração
  const { data: signedUrl, error: urlError } = await supabase
    .storage
    .from('thumbnails')
    .createSignedUrl(fileName, THUMBNAIL_SETTINGS.defaultExpiry);

  if (urlError || !signedUrl) {
    console.error('[THUMBNAIL] 🔴 Erro ao gerar URL:', urlError);
    throw new Error('Falha ao gerar URL de acesso');
  }

  console.log(`[THUMBNAIL] ✅ Thumbnail armazenado: ${fileName}`);
  return signedUrl.signedUrl;
}

// Gerar hash consistente para URLs
function hashUrl(url: string): string {
  return createHash('sha256')
    .update(url.replace(/^https?:\/\//, ''))
    .digest('hex');
}