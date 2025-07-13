import { supabase } from '@/utils/supabase'

interface VercelDeployment {
  id: string
  url: string
  name: string
  readyState: string
}

const sanitizeProjectName = (rawName: string): string => {
  return rawName
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '-')   // substitui inválidos por hífen
    .replace(/-{2,}/g, '-')          // unifica múltiplos hífens
    .replace(/^-+|-+$/g, '')         // retira hífens de borda
    .slice(0, 100)                   // até 100 chars
}

export const getOrCreateProjectId = async (userPhone: string): Promise<string> => {
  const { data: existing } = await supabase
    .from('user_projects')
    .select('project_id')
    .eq('user_phone', userPhone)
    .single()

  if (existing?.project_id) {
    return existing.project_id
  }

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
    console.error('Erro criando projeto:', data)
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
  // 1️⃣ Preparar o nome do deploy
  const rawDeployName = `site-${Date.now()}`
  const safeDeployName = sanitizeProjectName(rawDeployName)

  // 2️⃣ Criar deployment (envia html cru, não Base64)
  const deployRes = await fetch('https://api.vercel.com/v13/deployments', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.VERCEL_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      name: safeDeployName,
      project: projectId,
      target: 'production',
      files: [
        {
          file: '/index.html',
          data: htmlContent
        }
      ]
    })
  })

  const deployCT = deployRes.headers.get('content-type') || ''
  if (!deployRes.ok) {
    const errText = await deployRes.text()
    console.error('Erro no deployment Vercel:', errText)
    throw new Error(`Vercel deployment failed [${deployRes.status}]: ${errText}`)
  }
  if (!deployCT.includes('application/json')) {
    const errText = await deployRes.text()
    throw new Error(`Vercel não retornou JSON: ${errText.substring(0, 200)}`)
  }

  const deploymentData: VercelDeployment = await deployRes.json()

  // 3️⃣ Criar alias público para domínio de produção
  const aliasName = sanitizeProjectName(`site-${userPhone}`)
  const aliasRes = await fetch(
    `https://api.vercel.com/v13/deployments/${deploymentData.id}/aliases`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.VERCEL_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ alias: `${aliasName}.vercel.app` })
    }
  )

  if (!aliasRes.ok) {
    const aliasErr = await aliasRes.text()
    console.error('Erro criando alias no Vercel:', aliasErr)
    throw new Error(`Failed to alias deployment: ${aliasErr}`)
  }

  const publicUrl = `https://${aliasName}.vercel.app`
  console.log('✅ Deployment com alias público disponível em:', publicUrl)
  return { url: publicUrl, projectId }
}
