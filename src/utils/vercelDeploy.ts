import { supabase } from '@/utils/supabase'

interface VercelDeployment {
  id: string
  url: string
  name: string
  readyState: string
}

// 🧼 Função de sanitização de nomes para Vercel
const sanitizeProjectName = (rawName: string): string => {
  return rawName
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100)
}

export const getOrCreateProjectId = async (userPhone: string): Promise<string> => {
  const { data: existing } = await supabase
    .from('user_projects')
    .select('project_id')
    .eq('user_phone', userPhone)
    .single()

  if (existing?.project_id) {
    console.log('🔄 Projeto já vinculado:', existing.project_id)
    return existing.project_id
  }

  const safeProjectName = sanitizeProjectName(`site-${userPhone}`)
  console.log('🆕 Tentando criar novo projeto Vercel:', safeProjectName)

  const projectRes = await fetch('https://api.vercel.com/v9/projects', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.VERCEL_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ name: safeProjectName })
  })

  const projectData = await projectRes.json()

  if (projectRes.status === 409 && projectData?.error?.code === 'conflict') {
    console.warn('⚠️ Projeto já existe no Vercel. Recuperando...')

    const listRes = await fetch(`https://api.vercel.com/v9/projects?search=${safeProjectName}`, {
      headers: { Authorization: `Bearer ${process.env.VERCEL_TOKEN}` }
    })
    const listData = await listRes.json()
    const matched = listData.projects?.find((p: any) => p.name === safeProjectName)

    if (!matched?.id) throw new Error('Projeto existente não encontrado no painel da Vercel.')

    console.log('✅ Projeto recuperado:', matched.id)
    await supabase.from('user_projects').upsert({ user_phone: userPhone, project_id: matched.id })
    return matched.id
  }

  if (!projectRes.ok) {
    console.error('❌ Erro criando projeto Vercel:', projectData)
    throw projectData
  }

  const projectId = projectData.id
  console.log('✅ Projeto criado com ID:', projectId)

  await supabase.from('user_projects').upsert({ user_phone: userPhone, project_id: projectId })
  return projectId
}


export const deployOnVercel = async (
  htmlContent: string,
  projectId: string
): Promise<{ url: string; projectId: string }> => {
  try {
    // Criar nome seguro para o deploy
    const rawDeployName = `site-${Date.now()}`
    const safeDeployName = sanitizeProjectName(rawDeployName)

    console.log('🚀 Iniciando deployment no projeto:', projectId)

    const deploymentRes = await fetch('https://api.vercel.com/v13/deployments', {
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
            data: Buffer.from(htmlContent).toString('base64')
          }
        ]
      })
    })

    const deploymentData: VercelDeployment = await deploymentRes.json()
    if (!deploymentRes.ok) {
      console.error('❌ Erro no deployment Vercel:', deploymentData)
      throw deploymentData
    }

    const url = `https://${deploymentData.url}`
    console.log('✅ Deployment concluído:', url)
    return { url, projectId }
  } catch (error) {
    console.error('🔥 Vercel deployment error:', error)
    throw new Error('Failed to deploy on Vercel')
  }
}
