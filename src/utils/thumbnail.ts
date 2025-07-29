import { supabase } from "./supabase";
import { createHash } from 'crypto';

const THUMBNAIL_CONFIG = {
  services: [
    {
      name: 'screenshotone',
      url: 'https://api.screenshotone.com/take',
      params: {
        format: 'jpeg',
        viewport_width: '1280',
        viewport_height: '720',
        delay: '5',
        image_quality: '80'
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
        wait_for: '5000'
      }
    }
  ],
  placeholderUrl: 'https://via.placeholder.com/1280x720.png?text=Site+Preview'
};

export async function captureThumbnail(url: string): Promise<string> {
  // Verificar se a URL é válida
  if (!url || !url.startsWith('http')) {
    return THUMBNAIL_CONFIG.placeholderUrl;
  }

  for (const service of THUMBNAIL_CONFIG.services) {
    try {
      const imageUrl = await tryCaptureWithService(url, service);
      if (imageUrl) {
        return imageUrl;
      }
    } catch (error) {
      console.error(`[THUMBNAIL] ${service.name} error:`, error);
    }
  }

  return THUMBNAIL_CONFIG.placeholderUrl;
}

async function isUrlAccessible(url: string): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  
  try {
    const response = await fetch(url, { 
      method: 'HEAD',
      signal: controller.signal 
    });
    
    clearTimeout(timeout);
    return response.status === 200;
  } catch (error) {
    clearTimeout(timeout);
    console.error('[THUMBNAIL] URL accessibility check failed:', error);
    return false;
  }
}

async function tryCaptureWithService(url: string, service: any): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    const response = await fetch(`${service.url}?${new URLSearchParams({
      ...service.params,
      url: encodeURIComponent(url),
      ...(service.authKey ? { access_key: service.authKey } : {})
    })}`, { 
      signal: controller.signal
    });
    
    clearTimeout(timeout);

    if (!response.ok) {
      throw new Error(`API returned ${response.status}`);
    }

    if (service.name === 'microlink') {
      const data = await response.json();
      return data.data.screenshot.url;
    }

    const blob = await response.blob();
    return await uploadToSupabase(blob, url);
  } catch (error) {
    clearTimeout(timeout);
    throw error;
  }
}

async function uploadToSupabase(blob: Blob, originalUrl: string): Promise<string> {
  const urlHash = createHash('sha256').update(originalUrl).digest('hex');
  const fileName = `public/thumbnails/${urlHash}.jpg`;
  const arrayBuffer = await blob.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  const { error } = await supabase
    .storage
    .from('thumbnails')
    .upload(fileName, buffer, {
      contentType: 'image/jpeg',
      cacheControl: 'public, max-age=2592000', // 30 dias
      upsert: true
    });

  if (error) {
    throw error;
  }

  return `${process.env.SUPABASE_URL}/storage/v1/object/public/thumbnails/${fileName}`;
}