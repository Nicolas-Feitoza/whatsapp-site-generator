import { supabase } from "./supabase";

export async function captureThumbnail(url: string): Promise<string> {
  const accessKey = process.env.SCREENSHOTONE_ACCESS_KEY;
  if (!accessKey) throw new Error("🚨 SCREENSHOTONE_ACCESS_KEY não definida.");

  const endpoint =
    `https://api.screenshotone.com/v1/screenshot` +
    `?access_key=${accessKey}` +
    `&url=${encodeURIComponent(url)}` +
    `&format=png&fullpage=false&width=1280&height=720`;

  const res = await fetch(endpoint);
  if (!res.ok) throw new Error(`ScreenshotOne ${res.status}: ${await res.text()}`);

  const buffer = Buffer.from(await res.arrayBuffer());
  const fileName = `thumbnail-${Date.now()}.png`;

  const { data: up, error: upErr } = await supabase
    .storage.from("thumbnails")
    .upload(fileName, buffer, { contentType: "image/png", cacheControl: "3600" });
  if (upErr || !up?.path) throw new Error(`Upload falhou: ${upErr?.message}`);

  const { data: signed, error: signErr } =
    await supabase.storage.from("thumbnails").createSignedUrl(up.path, 3600);
  if (signErr || !signed?.signedUrl) throw new Error(`Signed URL falhou: ${signErr?.message}`);

  return signed.signedUrl;
}
