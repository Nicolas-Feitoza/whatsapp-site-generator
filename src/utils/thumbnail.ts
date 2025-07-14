import { supabase } from "./supabase";

export const captureThumbnail = async (rawUrl: string): Promise<string> => {
  // 0. Normaliza a URL
  const siteUrl = /^(https?:)?\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;

  // 1. Chama Microlink
  const api = `https://api.microlink.io?url=${encodeURIComponent(siteUrl)}` +
              "&screenshot=true&meta=false&prerender=true";
  const apiRes = await fetch(api);
  const { status, code, message, data } = await apiRes.json();
  if (status !== "success") throw new Error(`${code}: ${message}`);

  // 2. Obtém o Blob da imagem
  let blob: Blob;
  const url = data.screenshot.url as string;

  if (url.startsWith("data:")) {
    // data‑URI: data:image/png;base64,AAA...
    const [ header, b64 ] = url.split(",");
    const mime = header.match(/data:(.+);base64/)?.[1] || "application/octet-stream";
    const binary = atob(b64);
    const len = binary.length;
    const buffer = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      buffer[i] = binary.charCodeAt(i);
    }
    blob = new Blob([buffer], { type: mime });

  } else {
    // URL normal: faz fetch e pega blob
    const thumbRes = await fetch(url);
    const imgCT = thumbRes.headers.get("content-type") ?? "";
    if (!imgCT.startsWith("image/")) {
      throw new Error(`Microlink devolveu conteúdo inesperado: ${imgCT}`);
    }
    blob = await thumbRes.blob();
  }

  // 3. Faz upload do Blob no Supabase Storage
  const ext = blob.type.split("/")[1];
  const fileName = `thumbnail-${Date.now()}.${ext}`;
  const { data: up, error: upErr } = await supabase
    .storage
    .from("thumbnails")
    .upload(fileName, blob, {
      contentType: blob.type,
      cacheControl: "3600",
    });
  if (upErr) throw upErr;

  // 4. Gera URL assinada
  const { data: signed, error: signErr } = await supabase
    .storage
    .from("thumbnails")
    .createSignedUrl(up.path, 3600);
  if (signErr) throw signErr;

  return signed.signedUrl!;
};
