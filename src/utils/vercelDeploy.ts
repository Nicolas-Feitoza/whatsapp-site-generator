import { supabase } from '@/utils/supabase'

interface VercelDeployment {
  id: string
  url: string
  name: string
  readyState: string
}

const sanitizeProjectName = (rawName: string): string =>
  rawName
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100)

export const getOrCreateProjectId = async (userPhone: string): Promise<string> => {
  const { data: existing } = await supabase
    .from('user_projects')
    .select('project_id')
    .eq('user_phone', userPhone)
    .single()

  if (existing?.project_id) return existing.project_id

  const safeName = sanitizeProjectName(`site-${userPhone}`)
  const res = await fetch('https://api.vercel.com/v9/projects', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.VERCEL_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ name: safeName })
  })
  const data = await res.json()
  if (!res.ok && !(res.status === 409 && data.error?.code === 'conflict')) {
    throw new Error(JSON.stringify(data))
  }

  let projectId = data.id
  if (res.status === 409) {
    const listRes = await fetch(
      `https://api.vercel.com/v9/projects?search=${safeName}`,
      { headers: { Authorization: `Bearer ${process.env.VERCEL_TOKEN}` } }
    )
    const listData = await listRes.json()
    projectId = listData.projects.find((p: any) => p.name === safeName).id
  }

  await supabase
    .from('user_projects')
    .upsert({ user_phone: userPhone, project_id: projectId })

  return projectId
}

export const deployOnVercel = async (
  htmlContent: string,
  projectId: string,
  userPhone: string
): Promise<{ url: string; projectId: string }> => {
  const safeDeployName = sanitizeProjectName(`site-${Date.now()}`)
  const aliasName      = sanitizeProjectName(`site-${userPhone}`)

  const body = {
    name: safeDeployName,
    project: projectId,
    target: 'production',
    files: [
      { file: '/index.html', data: htmlContent }
    ],
    // **instruções para servir HTML como site estático**
    builds: [
      { src: 'index.html', use: '@vercel/static' }
    ],
    routes: [
      { src: '/(.*)', dest: '/index.html' }
    ]
  }

  const deployRes = await fetch('https://api.vercel.com/v13/deployments', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.VERCEL_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  })

  if (!deployRes.ok) {
    const err = await deployRes.text()
    throw new Error(`Deployment failed: ${err}`)
  }

  const deploymentData = await deployRes.json() as VercelDeployment

  // Polling até READY (iguala o código que você já tinha)
  let readyState = deploymentData.readyState
  for (let i = 0; i < 10 && readyState !== 'READY'; i++) {
    await new Promise(r => setTimeout(r, 2000))
    const checkRes = await fetch(
      `https://api.vercel.com/v13/deployments/${deploymentData.id}`,
      { headers: { Authorization: `Bearer ${process.env.VERCEL_TOKEN}` } }
    )
    const checkData = await checkRes.json() as VercelDeployment
    readyState = checkData.readyState
  }

  // Tenta criar alias
  if (readyState === 'READY') {
    await fetch(
      `https://api.vercel.com/v13/deployments/${deploymentData.id}/aliases`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.VERCEL_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ alias: `${aliasName}.vercel.app` })
      }
    ).catch(() => {/* só warning */})
  }

  const publicUrl = `https://${aliasName}.vercel.app`
  return { url: publicUrl, projectId }
}
