export const generateTemplate = async (userPrompt: string): Promise<string> => {
  const systemPrompt = `
Você é um gerador de sites profissionais.
Retorne **APENAS** o HTML completo (sem markdown), com:
- Tailwind CSS via CDN
- <meta name="viewport" content="width=device-width,initial-scale=1">
- <title>${userPrompt}</title> e favicon genérico
- Comentários <!-- TODO: ponto de edição --> nos pontos chave
`;

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "deepseek/deepseek-chat-v3-0324:free",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Crie um site completo para: "${userPrompt}"` },
      ],
    }),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`OpenRouter API error ${res.status}: ${text}`);
  }

  let payload: any;
  try {
    payload = JSON.parse(text);
  } catch (err: any) {
    throw new Error(`Falha ao parsear JSON da OpenRouter: ${err.message}. Resposta bruta: ${text}`);
  }

  const content = payload.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new Error(`Formato inesperado: ${text}`);
  }

  return content
    .replace(/^```(?:html)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
};
