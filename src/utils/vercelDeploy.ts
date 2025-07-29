import { supabase } from "./supabase";

interface VercelDeployment {
  id: string;
  readyState: string;
  projectId: string;
}

const DEPLOY_SETTINGS = {
  maxRetries: 3,
  retryDelay: 30000, // 30s
  initialTimeout: 120000, // 2min
  extendedTimeout: 180000 // 3min
};

const sanitize = (s: string) =>
  s.toLowerCase()
    .replace(/[^a-z0-9._-]/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);

export const deployOnVercel = async (
  htmlContent: string,
  projectId: string | null,
  userPhone: string
): Promise<{ url: string; projectId: string }> => {
  const deployName = sanitize(`site-${Date.now()}`);
  const aliasName = sanitize(`site-${userPhone.replace(/\D/g, '').slice(-8)}-${Date.now().toString(36)}`);
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= DEPLOY_SETTINGS.maxRetries; attempt++) {
    try {
      const body = {
        name: deployName,
        target: "production",
        public: true, // Garante que o deployment seja público
        files: [{ file: "/index.html", data: ensureCompleteHtml(htmlContent) }],
        builds: [{ src: "index.html", use: "@vercel/static" }],
        routes: [{ src: "/(.*)", dest: "/index.html" }],
        ...(projectId && { project: projectId }),
        projectSettings: {
          framework: null,
          buildCommand: null,
          outputDirectory: null
        }
      };

      // Tentativa de deployment
      const deployment = await attemptDeployment(body, attempt);
      
      // Configurar alias
      await setDeploymentAlias(deployment.id, aliasName);

      return {
        url: `https://${aliasName}.vercel.app`,
        projectId: deployment.projectId
      };

    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      console.error(`[DEPLOY] Attempt ${attempt} failed:`, error);
      if (attempt < DEPLOY_SETTINGS.maxRetries) {
        await new Promise(r => setTimeout(r, DEPLOY_SETTINGS.retryDelay));
      }
    }
  }

  throw lastError ?? new Error("Deployment failed after all retries");
};

// Funções auxiliares
function ensureCompleteHtml(html: string): string {
  if (html.includes('<html') && html.includes('<head')) return html;
  
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  ${!html.includes('<title>') ? '<title>Site Gerado</title>' : ''}
</head>
${!html.includes('<body>') ? `<body>${html}</body>` : html}
</html>`;
}

async function attemptDeployment(body: any, attempt: number): Promise<VercelDeployment> {
  const timeout = attempt === 1 ? DEPLOY_SETTINGS.initialTimeout : DEPLOY_SETTINGS.extendedTimeout;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const res = await fetch("https://api.vercel.com/v13/deployments", {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${process.env.VERCEL_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`Deployment failed: ${errorText}`);
    }

    const data = await res.json() as VercelDeployment;
    await waitForDeploymentReady(data.id, timeout);
    return data;

  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

async function waitForDeploymentReady(deploymentId: string, timeout: number): Promise<void> {
  const start = Date.now();
  let state = '';

  while (Date.now() - start < timeout) {
    const res = await fetch(`https://api.vercel.com/v13/deployments/${deploymentId}`, {
      headers: { Authorization: `Bearer ${process.env.VERCEL_TOKEN}` },
    });
    
    const deployment = await res.json() as VercelDeployment;
    state = deployment.readyState;

    if (state === 'READY') return;
    if (state === 'ERROR') throw new Error('Deployment failed');

    await new Promise(r => setTimeout(r, 2000)); // Polling a cada 2s
  }

  throw new Error(`Deployment timeout - last state: ${state}`);
}

async function setDeploymentAlias(deploymentId: string, alias: string): Promise<void> {
  try {
    await fetch(
      `https://api.vercel.com/v13/deployments/${deploymentId}/aliases`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.VERCEL_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ alias: `${alias}.vercel.app` }),
      }
    );
  } catch (error) {
    console.error("Alias setting failed (non-critical):", error);
  }
}