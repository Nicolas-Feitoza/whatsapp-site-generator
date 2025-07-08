import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import { supabase } from './supabase';

async function getPublicUrl(bucket: string, path: string): Promise<string> {
  const { data } = supabase.storage
    .from(bucket)
    .getPublicUrl(path, {
      download: false,
      transform: {
        width: 800,
        height: 600,
      },
    });

  return data.publicUrl;
}

export const captureThumbnail = async (url: string): Promise<string> => {
  let browser;
  
  try {
    // Configurar Puppeteer para ambiente Vercel
    browser = await puppeteer.launch({
      args: chromium.args,
      executablePath: process.env.CHROME_EXECUTABLE_PATH || await chromium.executablePath(),
      headless: true,
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1200, height: 630 });
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    
    // Capturar screenshot
    const screenshot = await page.screenshot({ type: 'jpeg', quality: 80 });
    
    // Upload para Supabase Storage
    const fileName = `thumbnail-${Date.now()}.jpg`;
    const { data, error } = await supabase.storage
      .from('thumbnails')
      .upload(fileName, screenshot, {
        contentType: 'image/jpeg',
        cacheControl: '3600',
        upsert: false
      });

    if (error) throw error;

    // Obter URL pública
    return getPublicUrl('thumbnails', data.path);
    
  } catch (error) {
    console.error('Thumbnail capture error:', error);
    throw new Error('Failed to generate thumbnail');
  } finally {
    if (browser) await browser.close();
  }
};