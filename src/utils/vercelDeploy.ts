import { supabase } from "./supabase";

interface VercelDeployment { 
  id: string; 
  readyState: string; 
  projectId: string;
}

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
  const aliasName = sanitize(`site-${userPhone}`);

  const body: any = {
    name: deployName,
    target: "production",
    files: [{ file: "/index.html", data: htmlContent }],
    builds: [{ src: "index.html", use: "@vercel/static" }],
    routes: [{ src: "/(.*)", dest: "/index.html" }]
  };

  if (projectId) {
    body.project = projectId;
  }

  const res = await fetch("https://api.vercel.com/v13/deployments", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.VERCEL_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  
  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Deployment failed: ${errorText}`);
  }
  
  const data = (await res.json()) as VercelDeployment;

  // Polling for deployment status
  let state = data.readyState;
  for (let i = 0; i < 10 && state !== "READY"; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const chk = await fetch(`https://api.vercel.com/v13/deployments/${data.id}`, {
      headers: { Authorization: `Bearer ${process.env.VERCEL_TOKEN}` },
    });
    const deployment = await chk.json() as VercelDeployment;
    state = deployment.readyState;
  }

  // Set alias
  if (state === "READY") {
    await fetch(
      `https://api.vercel.com/v13/deployments/${data.id}/aliases`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.VERCEL_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ alias: `${aliasName}.vercel.app` }),
      }
    ).catch(err => console.error("Alias error:", err));
  }

  return { 
    url: `https://${aliasName}.vercel.app`,
    projectId: data.projectId
  };
};