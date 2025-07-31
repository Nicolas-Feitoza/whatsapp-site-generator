import { supabase } from "./supabase";

export const deployOnVercel = async (
  htmlContent: string,
  userPhone: string
): Promise<string> => {
  const alias = `site-${userPhone.replace(/\D/g, '').slice(-8)}-${Date.now().toString(36)}`;
  
  // Adicionar ?public=true para garantir acesso público
  const publicUrl = `https://${alias}.vercel.app?public=true`;

  const response = await fetch("https://api.vercel.com/v13/deployments", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.VERCEL_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: `site-${Date.now()}`,
      target: "production",
      public: true, // Garantir projeto público
      files: [{ file: "/index.html", data: ensureCompleteHtml(htmlContent) }],
      builds: [{ src: "index.html", use: "@vercel/static" }],
      alias: publicUrl // Usar URL pública
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Falha no deploy: ${error}`);
  }

  const data = await response.json();
  const deploymentId = data.id;

  // Aguardar deploy finalizar
  await new Promise(resolve => setTimeout(resolve, 5000));
  
  // Obter URL real
  const deploymentResponse = await fetch(`https://api.vercel.com/v13/deployments/${deploymentId}`, {
    headers: { Authorization: `Bearer ${process.env.VERCEL_TOKEN}` }
  });
  
  const deploymentData = await deploymentResponse.json();
  return publicUrl;
};

function ensureCompleteHtml(content: string): string {
  if (content.includes('<html') && content.includes('</body>')) {
    return content;
  }

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://unpkg.com/boxicons@2.1.4/css/boxicons.min.css" rel="stylesheet">
  <style>body { opacity: 0; transition: opacity 0.3s; }</style>
</head>
<body class="bg-gray-50 min-h-screen">
  <main class="container mx-auto p-4">
    ${content}
  </main>
  <script>document.addEventListener('DOMContentLoaded', () => setTimeout(() => { document.body.style.opacity = '1' }, 300))</script>
</body>
</html>`;
}