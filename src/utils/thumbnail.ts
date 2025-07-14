import { supabase } from "./supabase";

export async function captureWithPageSpeed(url: string): Promise<string> {
  const apiKey = process.env.GOOGLE_PAGESPEED_KEY;
  if (!apiKey) throw new Error("❌ GOOGLE_PAGESPEED_KEY não está definida.");

  const endpoint =
    `https://www.googleapis.com/pagespeedonline/v5/runPagespeed` +
    `?url=${encodeURIComponent(url)}` +
    `&key=${apiKey}` +
    `&strategy=mobile`;

  const res = await fetch(endpoint);
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`❌ Pagespeed API error ${res.status}: ${txt}`);
  }

  const json = await res.json();
  const screenshotData = json.lighthouseResult?.audits?.["final-screenshot"]?.details?.data;
  if (!screenshotData || !screenshotData.startsWith("data:image")) {
    throw new Error("❌ Screenshot inválido ou ausente na resposta do PageSpeed.");
  }

  const [, b64] = screenshotData.split(",");
  const binary = Buffer.from(b64, "base64");
  const mime = screenshotData.match(/^data:(.+);base64/)?.[1] || "image/jpeg";
  const ext = mime.split("/")[1] || "jpg";
  const fileName = `thumbnail-${Date.now()}.${ext}`;

  // Upload para Supabase
  const { data: up, error: upErr } = await supabase
    .storage
    .from("thumbnails")
    .upload(fileName, binary, {
      contentType: mime,
      cacheControl: "3600",
    });

  if (upErr || !up?.path) {
    throw new Error(`❌ Falha no upload: ${upErr?.message || "Path ausente no retorno."}`);
  }

  // Geração de URL assinada
  const { data: signed, error: signErr } = await supabase
    .storage
    .from("thumbnails")
    .createSignedUrl(up.path, 3600);

  if (signErr || !signed?.signedUrl) {
    throw new Error(`❌ Falha ao gerar URL assinada: ${signErr?.message || "Dados nulos."}`);
  }

  return signed.signedUrl;
}
