export const generateTemplate = async (userPrompt: string): Promise<string> => {
  try {
    const response = await fetch(
      'https://openrouter.ai/api/v1/chat/completions',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
          'HTTP-Referer': process.env.BASE_URL || 'http://localhost:3000',
          'X-Title': 'Site Generator Pro',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'deepseek/deepseek-chat-v3-0324:free',
          messages: [
            {
              role: 'system',
              content: `Você é um especialista em desenvolvimento web. Retorne SOMENTE código HTML/CSS/JS completo, sem comentários ou markdown. 
Inclua tudo inline. Use: Tailwind CSS via CDN, designs modernos e responsivos, componentes interativos com JS quando necessário.
Estrutura típica: <header>, <main> com seções, <footer>.`,
            },
            {
              role: 'user',
              content: `Crie um site completo para: "${userPrompt}". 
Siga estas diretrizes:
1. Layout profissional com no mínimo 3 seções
2. Design responsivo (mobile-first)
3. Interatividade básica (menu mobile, formulários)
4. Estilos com Tailwind CSS via CDN
5. Conteúdo relevante para o tema
Retorne APENAS o código HTML.`,
            },
          ],
        }),
      }
    )

    const ct = response.headers.get('content-type') || ''
    // 1) Status code
    if (!response.ok) {
      const text = await response.text()
      throw new Error(
        `OpenRouter API error: status ${response.status}. Body: ${text.slice(0, 200)}`
      )
    }
    // 2) Content-Type JSON
    if (!ct.includes('application/json')) {
      const text = await response.text()
      throw new Error(
        `OpenRouter API retornou conteúdo inesperado (${ct}): ${text
          .replace(/\s+/g, ' ')
          .slice(0, 200)}`
      )
    }

    // 3) JSON parse seguro
    let payload: any
    try {
      payload = await response.json()
    } catch (parseErr: any) {
      throw new Error(`Falha ao parsear JSON da OpenRouter: ${parseErr.message}`)
    }

    // 4) Validação do payload
    const content = payload.choices?.[0]?.message?.content
    if (typeof content !== 'string' || !content.trim()) {
      throw new Error(
        `OpenRouter retornou formato inesperado: ${JSON.stringify(payload).slice(
          0,
          200
        )}`
      )
    }

    return content
  } catch (err: unknown) {
    console.error('AI generation error:', err)
    // repassa mensagem original quando possível
    const msg = err instanceof Error ? err.message : 'Unknown AI error'
    throw new Error(`Failed to generate template: ${msg}`)
  }
}
