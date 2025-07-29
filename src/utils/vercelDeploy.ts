import { supabase } from "./supabase";

interface VercelDeployment {
  id: string;
  readyState: string;
  projectId: string;
  url: string;
}

export const deployOnVercel = async (
  htmlContent: string,
  projectId: string | null,
  userPhone: string
): Promise<{ url: string; projectId: string }> => {
  // Validate HTML content
  const completeHtml = ensureCompleteHtml(htmlContent);
  if (!completeHtml.includes('<html') || !completeHtml.includes('<body')) {
    throw new Error('Invalid HTML content generated');
  }

  const aliasName = `site-${userPhone.replace(/\D/g, '').slice(-8)}-${Date.now().toString(36)}`;

  const body = {
    name: `site-${Date.now()}`,
    target: "production",
    public: true,
    files: [{ file: "/index.html", data: completeHtml }],
    builds: [{ src: "index.html", use: "@vercel/static" }],
    routes: [{ src: "/(.*)", dest: "/index.html" }],
    projectSettings: {
      framework: null,
      buildCommand: null,
      outputDirectory: null
    }
  };

  // Create deployment
  const deployment = await createDeployment(body);
  
  // Wait for deployment to be ready
  await waitUntilDeploymentReady(deployment.id);
  
  // Create alias
  await createAlias(deployment.id, aliasName);

  // Verify deployment is accessible
  await verifyDeployment(`https://${aliasName}.vercel.app`);

  return {
    url: `https://${aliasName}.vercel.app`,
    projectId: deployment.projectId
  };
};

// Helper functions
async function createDeployment(body: any): Promise<VercelDeployment> {
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

  return await res.json();
}

async function waitUntilDeploymentReady(deploymentId: string, timeout = 120000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const deployment = await getDeployment(deploymentId);
    if (deployment.readyState === 'READY') return;
    if (deployment.readyState === 'ERROR') throw new Error('Deployment failed');
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
  throw new Error('Deployment timed out');
}

async function getDeployment(deploymentId: string): Promise<VercelDeployment> {
  const res = await fetch(`https://api.vercel.com/v13/deployments/${deploymentId}`, {
    headers: {
      Authorization: `Bearer ${process.env.VERCEL_TOKEN}`,
    },
  });
  return await res.json();
}

async function verifyDeployment(url: string): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    const response = await fetch(url, { 
      signal: controller.signal 
    });
    clearTimeout(timeout);
    
    if (response.status !== 200) {
      throw new Error(`Deployment verification failed: ${response.status}`);
    }
  } catch (error) {
    clearTimeout(timeout);
    throw new Error(`Failed to verify deployment: ${error instanceof Error ? error.message : String(error)}`);
  }
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
    throw error;
  }
}

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
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body>${content}</body>
</html>`;
}