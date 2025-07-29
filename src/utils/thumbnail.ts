import { supabase } from "./supabase";
import { createHash } from 'crypto';

const THUMBNAIL_CONFIG = {
  services: [
    {
      name: 'screenshotone',
      url: 'https://api.screenshotone.com/take',
      params: {
        format: 'jpg',
        viewport_width: '1280',
        viewport_height: '720',
        delay: '5',
        image_quality: '80',
        block_cookie_banners: 'true',
        block_trackers: 'true',
        timeout: '30'
      },
      authKey: process.env.SCREENSHOTONE_ACCESS_KEY
    },
    {
      name: 'microlink',
      url: 'https://api.microlink.io',
      params: {
        screenshot: 'true',
        meta: 'false',
        viewport_width: '1280',
        viewport_height: '720',
        wait_for: '5000',
        timeout: '30000'
      }
    }
  ],
  maxAttempts: 2,
  placeholderUrl: 'https://via.placeholder.com/1280x720.png?text=Preview+Indispon%C3%ADvel',
  storagePath: 'public/thumbnails'
};

export async function captureThumbnail(targetUrl: string): Promise<string> {
  // Verificar se já existe thumbnail para esta URL
  const existingThumb = await checkExistingThumbnail(targetUrl);
  if (existingThumb) return existingThumb;

  for (const service of THUMBNAIL_CONFIG.services) {
    try {
      const imageBuffer = await captureWithService(targetUrl, service);
      if (imageBuffer) {
        return await storeThumbnail(targetUrl, imageBuffer);
      }
    } catch (error) {
      console.error(`[THUMBNAIL] ${service.name} failed:`, error instanceof Error ? error.message : String(error));
    }
  }

  console.warn('[THUMBNAIL] All capture services failed, using placeholder');
  return THUMBNAIL_CONFIG.placeholderUrl;
}

async function checkExistingThumbnail(url: string): Promise<string | null> {
  const urlHash = createHash('sha256').update(url).digest('hex');
  const fileName = `${THUMBNAIL_CONFIG.storagePath}/${urlHash}.jpg`;

  try {
    const { data } = await supabase
      .storage
      .from('thumbnails')
      .getPublicUrl(fileName);

    // Verificar se a imagem existe
    const checkResponse = await fetch(data.publicUrl);
    if (checkResponse.ok) {
      return data.publicUrl;
    }
  } catch (error) {
    console.error('[THUMBNAIL] Existing thumbnail check failed:', error);
  }
  return null;
}

async function captureWithService(url: string, service: typeof THUMBNAIL_CONFIG.services[0]): Promise<Buffer> {
  const params = new URLSearchParams();
  
  // Adicionar parâmetros dinamicamente
  Object.entries(service.params).forEach(([key, value]) => {
    if (value !== undefined) {
      params.append(key, String(value));
    }
  });

  params.append('url', encodeURIComponent(url));

  if (service.authKey) {
    params.append('access_key', service.authKey);
  }

  const apiUrl = `${service.url}?${params.toString()}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);

  try {
    const response = await fetch(apiUrl, { 
      signal: controller.signal 
    });
    clearTimeout(timeoutId);
    return Buffer.from(await response.arrayBuffer());
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  } 
}

async function storeThumbnail(url: string, buffer: Buffer): Promise<string> {
  const urlHash = createHash('sha256').update(url).digest('hex');
  const fileName = `${THUMBNAIL_CONFIG.storagePath}/${urlHash}.jpg`;

  const { error } = await supabase
    .storage
    .from('thumbnails')
    .upload(fileName, buffer, {
      contentType: 'image/jpeg',
      cacheControl: 'public, max-age=2592000',
      upsert: true
    });

  if (error) {
    throw new Error(`Storage upload failed: ${error.message}`);
  }

  return `${process.env.SUPABASE_URL}/storage/v1/object/public/thumbnails/${fileName}`;
}