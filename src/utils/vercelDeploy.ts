import { supabase } from "./supabase";

interface VercelDeployment { id: string; readyState: string; }

const sanitize = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9._-]/g, "-").replace(/-{2,}/g, "-").replace(/^-+|-+$/g, "").slice(0,100);

export const deployOnVercel = async (
  htmlContent: string,
  projectId: string,
  userPhone: string
): Promise<{ url: string }> => {
  const deployName = sanitize(`site-${Date.now()}`);
  const aliasName  = sanitize(`site-${userPhone}`);

  const body = {
    name: deployName,
    project: projectId,
    target: "production",
    files: [{ file: "/index.html", data: htmlContent }],
    builds: [{ src: "index.html", use: "@vercel/static" }],
    routes: [{ src: "/(.*)", dest: "/index.html" }]
  };

  const res = await fetch("https://api.vercel.com/v13/deployments", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.VERCEL_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Deployment failed: ${await res.text()}`);
  const data = (await res.json()) as VercelDeployment;

  // polling
  let state = data.readyState;
  for (let i = 0; i < 10 && state !== "READY"; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const chk = await fetch(`https://api.vercel.com/v13/deployments/${data.id}`, {
      headers: { Authorization: `Bearer ${process.env.VERCEL_TOKEN}` },
    });
    const js = await chk.json() as VercelDeployment;
    state = js.readyState;
  }

  // alias
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
    ).catch(() => {});
  }

  return { url: `https://${aliasName}.vercel.app` };
};
