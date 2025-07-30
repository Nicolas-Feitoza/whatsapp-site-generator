import { supabase } from "./supabase";

export const deployOnVercel = async (
  htmlContent: string,
  userPhone: string
): Promise<string> => {
  const alias = `site-${userPhone.replace(/\D/g, '').slice(-8)}-${Date.now().toString(36)}`;
  
  const response = await fetch("https://api.vercel.com/v13/deployments", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.VERCEL_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: `site-${Date.now()}`,
      target: "production",
      public: true,
      files: [{ file: "/index.html", data: ensureCompleteHtml(htmlContent) }],
      builds: [{ src: "index.html", use: "@vercel/static" }],
      alias: `${alias}.vercel.app`
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Falha no deploy: ${error}`);
  }

  return `https://${alias}.vercel.app`;
};

function ensureCompleteHtml(content: string): string {
  return content.includes('<html') ? content : `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body>${content}</body>
</html>`;
}