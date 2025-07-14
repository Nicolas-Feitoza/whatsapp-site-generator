import { supabase } from "./supabase";

export const captureThumbnail = async (rawUrl: string): Promise<string> => {
  // 0. Normaliza a URL
  const siteUrl = /^(https?:)?\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;

  // 1. Chama Microlink
  const api = `https://api.microlink.io?url=${encodeURIComponent(siteUrl)}` +
              '&screenshot=true&meta=false&prerender=true';
  const apiRes = await fetch(api);
  const { status, code, message, data } = await apiRes.json();
  if (status !== 'success') throw new Error(`${code}: ${message}`);

  // 2. Baixa a imagem
  const thumbRes = await fetch(data.screenshot.url);
  const imgCT = thumbRes.headers.get('content-type') ?? 'application/octet-stream';
  if (!imgCT.startsWith('image/')) throw new Error(`Microlink devolveu ${imgCT}`);
  const buffer = Buffer.from(await thumbRes.arrayBuffer());

  // 3. Faz upload (extensão correta!)
  const ext = imgCT.split('/')[1];
  const fileName = `thumbnail-${Date.now()}.${ext}`;
  const { data: up, error: upErr } =
    await supabase.storage.from('thumbnails').upload(fileName, buffer, {
      contentType: imgCT,
      cacheControl: '3600'
    });
  if (upErr) throw upErr;

  // 4. Gera URL assinada
  const { data: signed, error: signErr } =
    await supabase.storage.from('thumbnails').createSignedUrl(up.path, 3600);
  if (signErr) throw signErr;

  return signed.signedUrl!;
};
