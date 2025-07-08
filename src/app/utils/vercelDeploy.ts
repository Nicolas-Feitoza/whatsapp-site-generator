interface VercelDeployment {
    id: string;
    url: string;
    readyState: string;
  }
  
  export const deployOnVercel = async (htmlContent: string): Promise<string> => {
    try {
      // Criar um projeto temporário
      const projectResponse = await fetch('https://api.vercel.com/v9/projects', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.VERCEL_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          name: `temp-site-${Date.now()}`,
          framework: 'static'
        })
      });
  
      const projectData = await projectResponse.json();
      if (!projectResponse.ok) throw projectData.error;
  
      // Fazer deploy do HTML
      const deploymentResponse = await fetch(`https://api.vercel.com/v13/deployments?projectId=${projectData.id}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.VERCEL_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          files: [
            {
              file: '/index.html',
              data: Buffer.from(htmlContent).toString('base64')
            }
          ],
          projectSettings: {
            buildCommand: null,
            outputDirectory: null,
            framework: null
          }
        })
      });
  
      const deploymentData: VercelDeployment = await deploymentResponse.json();
      if (!deploymentResponse.ok) throw deploymentData;
  
      // Retornar URL do deployment
      return `https://${deploymentData.url}`;
    } catch (error) {
      console.error('Vercel deployment error:', error);
      throw new Error('Failed to deploy on Vercel');
    }
  };