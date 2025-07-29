import { supabase } from "./supabase";

interface VercelDeployment {
  id: string;
  readyState: string;
  projectId: string;
  alias: string[];
}

const DEPLOY_SETTINGS = {
  maxRetries: 3,
  retryDelay: 30000,
  deploymentTimeout: 180000
};

export const deployOnVercel = async (
  htmlContent: string,
  projectId: string | null,
  userPhone: string
): Promise<{ url: string; projectId: string }> => {
  const aliasName = generateAlias(userPhone);
  const fullHtml = ensureCompleteHtml(htmlContent);

  for (let attempt = 1; attempt <= DEPLOY_SETTINGS.maxRetries; attempt++) {
    try {
      const deployment = await createDeployment(fullHtml, projectId);
      await assignAlias(deployment.id, aliasName);
      
      return {
        url: `https://${aliasName}.vercel.app`,
        projectId: deployment.projectId
      };
    } catch (error) {
      console.error(`[DEPLOY] Attempt ${attempt} failed:`, error);
      if (attempt < DEPLOY_SETTINGS.maxRetries) {
        await new Promise(r => setTimeout(r, DEPLOY_SETTINGS.retryDelay));
      }
    }
  }

  throw new Error('Deployment failed after all retries');
};

// Funções auxiliares
function generateAlias(phone: string): string {
  const cleanPhone = phone.replace(/\D/g, '').slice(-8);
  return `site-${cleanPhone}-${Date.now().toString(36)}`;
}

function ensureCompleteHtml(content: string): string {
  const hasHtmlTag = content.includes('<html') && content.includes('<head');
  if (hasHtmlTag) return content;
  
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  ${content.includes('<title>') ? '' : '<title>Site Gerado</title>'}
</head>
${content.includes('<body>') ? content : `<body>${content}</body>`}
</html>`;
}

async function createDeployment(html: string, projectId: string | null): Promise<VercelDeployment> {
  const body = {
    name: `site-${Date.now()}`,
    target: 'production',
    public: true, // Garante que o deployment seja público
    files: [{ file: '/index.html', data: html }],
    builds: [{ src: 'index.html', use: '@vercel/static' }],
    routes: [{ src: '/(.*)', dest: '/index.html' }],
    projectSettings: {
      framework: null, // Força projeto estático
      buildCommand: null,
      outputDirectory: null
    },
    ...(projectId && { project: projectId })
  };

  const res = await fetch('https://api.vercel.com/v13/deployments', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.VERCEL_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const error = await res.text();
    throw new Error(`Deployment failed: ${error}`);
  }

  const data = await res.json() as VercelDeployment;
  await waitForDeployment(data.id);
  return data;
}

async function waitForDeployment(deploymentId: string): Promise<void> {
  const start = Date.now();
  
  while (Date.now() - start < DEPLOY_SETTINGS.deploymentTimeout) {
    const res = await fetch(`https://api.vercel.com/v13/deployments/${deploymentId}`, {
      headers: { Authorization: `Bearer ${process.env.VERCEL_TOKEN}` },
    });
    
    const deployment = await res.json() as VercelDeployment;
    
    if (deployment.readyState === 'READY') return;
    if (deployment.readyState === 'ERROR') throw new Error('Deployment failed');
    
    await new Promise(r => setTimeout(r, 2000));
  }

  throw new Error('Deployment timeout');
}

async function assignAlias(deploymentId: string, alias: string): Promise<void> {
  const res = await fetch(
    `https://api.vercel.com/v13/deployments/${deploymentId}/aliases`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.VERCEL_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ 
        alias: `${alias}.vercel.app`,
        // Configurações adicionais para garantir acesso público
        protectionBypass: { "none": true }
      }),
    }
  );

  if (!res.ok) {
    console.error('Alias assignment failed:', await res.text());
  }
}