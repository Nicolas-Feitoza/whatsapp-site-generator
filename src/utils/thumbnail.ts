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
        block_trackers: 'true'
      },
      authKey: process.env.SCREENSHOTONE_ACCESS_KEY
    },
    {
      name: 'microlink',
      url: 'https://api.microlink.io',
      params: {
        screenshot: 'true',
        meta: 'false',
        embed: 'screenshot.url',
        viewport_width: '1280',
        viewport_height: '720',
        wait_for: '5000'
      }
    }
  ],
  maxAttempts: 2,
  placeholderUrl: 'https://your-app.com/default-thumbnail.jpg',
  storagePath: 'public/thumbnails'
};

export async function captureThumbnail(targetUrl: string): Promise<string> {
  for (const service of THUMBNAIL_CONFIG.services) {
    try {
      const imageBuffer = await captureWithService(targetUrl, service);
      if (imageBuffer) {
        return await storeThumbnail(targetUrl, imageBuffer);
      }
    } catch (error) {
      console.error(`[THUMBNAIL] ${service.name} attempt failed:`, error instanceof Error ? error.message : String(error));
    }
  }

  console.warn('[THUMBNAIL] All capture services failed, using placeholder');
  return THUMBNAIL_CONFIG.placeholderUrl;
}

async function captureWithService(url: string, service: typeof THUMBNAIL_CONFIG.services[0]): Promise<Buffer> {
  const cleanedParams = Object.entries({
    ...service.params,
    url: encodeURIComponent(url),
    ...(service.authKey ? { access_key: service.authKey } : {})
  }).reduce((acc, [key, value]) => {
    if (typeof value === 'string') {
      acc[key] = value;
    }
    return acc;
  }, {} as Record<string, string>);
  
  const params = new URLSearchParams(cleanedParams);

  if (service.authKey) {
    params.append('access_key', service.authKey);
  }

  const apiUrl = `${service.url}?${params.toString()}`;
  const response = await fetch(apiUrl);

  if (!response.ok) {
    throw new Error(`Service ${service.name} returned ${response.status}`);
  }

  return Buffer.from(await response.arrayBuffer());
}

async function storeThumbnail(url: string, buffer: Buffer): Promise<string> {
  const urlHash = createHash('sha256').update(url).digest('hex');
  const fileName = `${THUMBNAIL_CONFIG.storagePath}/${urlHash}.jpg`;

  const { error } = await supabase
    .storage
    .from('thumbnails')
    .upload(fileName, buffer, {
      contentType: 'image/jpeg',
      cacheControl: 'public, max-age=2592000', // 30 dias
      upsert: true
    });

  if (error) {
    throw new Error(`Storage upload failed: ${error.message}`);
  }

  return `${process.env.SUPABASE_URL}/storage/v1/object/public/thumbnails/${fileName}`;
}