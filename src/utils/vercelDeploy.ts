import { supabase } from '@/utils/supabase'

interface VercelDeployment {
  id: string
  url: string      // subdomínio gerado pelo Vercel, ex: abc123.vercel.app
  name: string
  readyState: string
}

// Função de sanitização de nomes para Vercel
const sanitizeProjectName = (rawName: string): string =>
  rawName
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '-')   // inválidos → hífen
    .replace(/-{2,}/g, '-')          // múltiplos hífens → um só
    .replace(/^-+|-+$/g, '')         // hífens de borda
    .slice(0, 100)                   // até 100 chars

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

  // Erro inesperado (exceto conflito)
  if (!res.ok && !(res.status === 409 && data.error?.code === 'conflict')) {
    console.error('Erro criando projeto:', data)
    throw new Error(JSON.stringify(data))
  }

  // Se conflito, buscamos ID pelo nome
  let projectId = data.id
  if (res.status === 409) {
    const listRes = await fetch(
      `https://api.vercel.com/v9/projects?search=${safeName}`,
      { headers: { Authorization: `Bearer ${process.env.VERCEL_TOKEN}` } }
    )
    const listData = await listRes.json()
    const match = listData.projects.find((p: any) => p.name === safeName)
    projectId = match.id
  }

  // Vincula ao Supabase
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
  // 1️⃣ Preparar nomes
  const safeDeployName = sanitizeProjectName(`site-${Date.now()}`)
  const aliasName      = sanitizeProjectName(`site-${userPhone}`)

  // 2️⃣ Criar deployment (HTML cru)
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

  if (!deployRes.ok) {
    const err = await deployRes.text()
    console.error('Erro no deployment Vercel:', err)
    throw new Error(`Deployment failed: ${err}`)
  }

  const deploymentData: VercelDeployment = await deployRes.json()
  console.log('🚀 Deploy criado, aguardando READY…', deploymentData.id)

  // 3️⃣ Polling até readyState = READY (máx 10 tentativas)
  let readyState = deploymentData.readyState
  for (let i = 0; i < 10 && readyState !== 'READY'; i++) {
    await new Promise(r => setTimeout(r, 2000))
    const checkRes = await fetch(
      `https://api.vercel.com/v13/deployments/${deploymentData.id}`,
      { headers: { Authorization: `Bearer ${process.env.VERCEL_TOKEN}` } }
    )
    if (checkRes.ok) {
      const checkData = await checkRes.json() as VercelDeployment
      readyState = checkData.readyState
      console.log(`🔄 ReadyState check #${i + 1}:`, readyState)
    }
  }

  // 4️⃣ Criar alias público (se deployment estiver pronto)
  try {
    if (readyState === 'READY') {
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
        console.warn('⚠️ Alias creation warning:', aliasErr)
      } else {
        console.log('✅ Alias criado:', `${aliasName}.vercel.app`)
      }
    } else {
      console.warn('⚠️ Deployment não ficou READY a tempo, pulando alias.')
    }
  } catch (aliasErr) {
    console.warn('⚠️ Erro ao criar alias (capturado):', aliasErr)
  }

  // 5️⃣ Montar URL pública e retornar
  const publicUrl = `https://${aliasName}.vercel.app`
  console.log('🌐 Site disponível em:', publicUrl)
  return { url: publicUrl, projectId }
}
