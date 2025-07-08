export const generateTemplate = async (userPrompt: string): Promise<string> => {
    try {
      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
          "HTTP-Referer": process.env.BASE_URL || "http://localhost:3000",
          "X-Title": "Site Generator Pro",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: "deepseek/deepseek-chat-v3-0324:free",
          messages: [
            {
              role: "system",
              content: `Você é um especialista em desenvolvimento web. Retorne SOMENTE código HTML/CSS/JS completo, sem comentários ou markdown. 
              Inclua tudo inline. Use: Tailwind CSS via CDN, designs modernos e responsivos, componentes interativos com JS quando necessário.
              Estrutura típica: <header>, <main> com seções, <footer>.`
            },
            {
              role: "user",
              content: `Crie um site completo para: "${userPrompt}". 
              Siga estas diretrizes:
              1. Layout profissional com no mínimo 3 seções
              2. Design responsivo (mobile-first)
              3. Interatividade básica (menu mobile, formulários)
              4. Estilos com Tailwind CSS via CDN
              5. Conteúdo relevante para o tema
              Retorne APENAS o código HTML.`
            }
          ]
        })
      });
  
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error?.message || 'OpenRouter API error');
      }
  
      return data.choices[0].message.content;
    } catch (error) {
      console.error('AI generation error:', error);
      throw new Error('Failed to generate template');
    }
  };