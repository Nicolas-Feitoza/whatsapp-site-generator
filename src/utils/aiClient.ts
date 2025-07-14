// src/utils/aiClient.ts
export const generateTemplate = async (userPrompt: string): Promise<string> => {
  // 1️⃣ Requisição
  const response = await fetch(
    'https://openrouter.ai/api/v1/chat/completions',  // confirme seu endpoint
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
            content: `Você é um especialista em desenvolvimento web...
Inline, sem comentários, Tailwind CDN, etc.`
          },
          {
            role: 'user',
            content: `Crie um site completo para: "${userPrompt}"...`
          }
        ],
      }),
    }
  );

  // 2️⃣ Leia o corpo como texto para poder debugar
  const text = await response.text();

  // 3️⃣ Se não for 2xx, joga o corpo como erro
  if (!response.ok) {
    throw new Error(
      `OpenRouter API error: status ${response.status}. Body: ${text}`
    );
  }

  // 4️⃣ Tenta parsear JSON dentro de try/catch
  let payload: any;
  try {
    payload = JSON.parse(text);
  } catch (err: any) {
    throw new Error(
      `Falha ao parsear JSON da OpenRouter: ${err.message}. Resposta bruta: ${text}`
    );
  }

  // 5️⃣ Extrai o conteúdo
  const content = payload.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) {
    throw new Error(`Formato inesperado da OpenRouter: ${text}`);
  }

  // 6️⃣ Remove fences ```html … ```
  return content
    .replace(/^```(?:html)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
};
