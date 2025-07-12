import { supabase } from '@/utils/supabase'

interface VercelDeployment {
  id: string
  url: string
  name: string
  readyState: string
}

export const getOrCreateProjectId = async (userPhone: string): Promise<string> => {
  // Buscar project_id já vinculado ao número
  const { data: existing } = await supabase
    .from('user_projects')
    .select('project_id')
    .eq('user_phone', userPhone)
    .single()

  if (existing?.project_id) {
    console.log('🔄 Projeto já vinculado:', existing.project_id)
    return existing.project_id
  }

  // Criar novo projeto no Vercel
  console.log('🆕 Criando novo projeto Vercel...')
  const projectRes = await fetch('https://api.vercel.com/v9/projects', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.VERCEL_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ name: `site-${userPhone}` })
  })

  const projectData = await projectRes.json()
  if (!projectRes.ok) {
    console.error('❌ Erro criando projeto Vercel:', projectData)
    throw projectData
  }

  const projectId = projectData.id
  console.log('✅ Projeto criado com ID:', projectId)

  // Vincular ao usuário
  await supabase.from('user_projects').upsert({ user_phone: userPhone, project_id: projectId })

  return projectId
}

export const deployOnVercel = async (
  htmlContent: string,
  projectId: string
): Promise<{ url: string; projectId: string }> => {
  try {
    console.log('🚀 Iniciando deployment no projeto:', projectId)

    const deploymentRes = await fetch('https://api.vercel.com/v13/deployments', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.VERCEL_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: `site-${Date.now()}`,
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
