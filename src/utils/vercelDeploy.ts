import { supabase } from "./supabase";

interface VercelDeployment {
  id: string;
  readyState: string;
  projectId: string;
}

export const deployOnVercel = async (
  htmlContent: string,
  projectId: string | null,
  userPhone: string
): Promise<{ url: string; projectId: string }> => {
  // Garantir que o HTML tenha a estrutura mínima necessária
  const completeHtml = ensureCompleteHtml(htmlContent);
  
  // Criar um nome único para o deployment
  const aliasName = `site-${userPhone.replace(/\D/g, '').slice(-8)}-${Date.now().toString(36)}`;

  // Configuração do deployment
  const body = {
    name: `site-${Date.now()}`,
    target: "production",
    public: true, // Isso é CRUCIAL para evitar tela de login
    files: [{ file: "/index.html", data: completeHtml }],
    builds: [{ src: "index.html", use: "@vercel/static" }],
    routes: [{ src: "/(.*)", dest: "/index.html" }],
    projectSettings: {
      framework: null, // Forçar site estático
      buildCommand: null,
      outputDirectory: null
    }
  };

  // Criar o deployment
  const res = await fetch("https://api.vercel.com/v13/deployments", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.VERCEL_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const error = await res.text();
    throw new Error(`Deployment failed: ${error}`);
  }

  const data = await res.json() as VercelDeployment;

  // Criar alias público
  await createAlias(data.id, aliasName);

  return {
    url: `https://${aliasName}.vercel.app`,
    projectId: data.projectId
  };
};

// Funções auxiliares
function ensureCompleteHtml(content: string): string {
  if (content.includes('<html') && content.includes('<head')) {
    return content;
  }
  
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Site Gerado</title>
</head>
<body>${content}</body>
</html>`;
}

async function createAlias(deploymentId: string, alias: string): Promise<void> {
  try {
    await fetch(
      `https://api.vercel.com/v13/deployments/${deploymentId}/aliases`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.VERCEL_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ 
          alias: `${alias}.vercel.app`
        }),
      }
    );
  } catch (error) {
    console.error("Alias creation error:", error);
  }
}