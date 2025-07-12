interface VercelDeployment {
  id: string
  url: string
  name: string
  readyState: string
}

export const deployOnVercel = async (
  htmlContent: string,
  existingProjectId?: string
): Promise<{ url: string; projectId: string }> => {
  let projectId = existingProjectId

  try {
    // 1️⃣ Criar projeto apenas se não existir
    if (!projectId) {
      console.log('🆕 Criando novo projeto Vercel...')
      const projectResponse = await fetch('https://api.vercel.com/v9/projects', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.VERCEL_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          name: `temp-site-${Date.now()}`,
        }),
      });
      const projectData = await projectResponse.json()
      if (!projectResponse.ok) {
        console.error('❌ Erro criando projeto Vercel:', projectData)
        throw projectData
      };
      projectId = projectData.id;
      console.log('✅ Projeto criado com ID:', projectId)
    } else {
      console.log('🔄 Reaproveitando projeto existente:', projectId)
    }

    // 2️⃣ Deploy do HTML
    console.log('🚀 Iniciando deployment no projeto:', projectId)
    const deploymentResponse = await fetch('https://api.vercel.com/v13/deployments', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.VERCEL_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: `temp-site-${Date.now()}`,
        project: projectId,
        target: 'production',
        files: [
          {
            file: '/index.html',
            data: Buffer.from(htmlContent).toString('base64'),
          },
        ],
        projectSettings: { framework: null }
      })
    });
    const deploymentData: VercelDeployment = await deploymentResponse.json();
    if (!deploymentResponse.ok) {
      console.error('❌ Erro no deployment Vercel:', deploymentData);
      throw deploymentData;
    };
    if (!projectId) {
      throw new Error('Project ID is undefined');
    };
    
    const url = `https://${deploymentData.url}`;
    console.log('✅ Deployment concluído:', url);
    
    return { url, projectId };
  } catch (error) {
    console.error('🔥 Vercel deployment error:', error);
    throw new Error('Failed to deploy on Vercel');
  }
}
