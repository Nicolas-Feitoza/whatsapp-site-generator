export const generateTemplate = async (userPrompt: string): Promise<string> => {
  const systemPrompt = `
Você é um gerador de sites profissionais. Retorne APENAS o HTML completo com:
1. Tailwind CSS via CDN
2. Estrutura HTML5 completa
3. Ícones via CDN (usando Boxicons)
4. Título baseado no prompt
5. REMOVA quaisquer comentários ou placeholders

Regras estritas:
- NÃO inclua markdown (\`\`\`html)
- NÃO adicione comentários
- SEM mensagens explicativas
- Priorize componentes prontos do Tailwind
`;

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "anthropic/claude-3-haiku",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Crie um site para: "${userPrompt}"` },
      ],
    }),
  });

  const data = await res.json();
  let html = data?.choices?.[0]?.message?.content?.trim() ?? "";

  // Verificações de estrutura
  const hasDoctype = html.includes("<!DOCTYPE");
  const hasHtml = html.includes("<html");
  const hasHead = html.includes("<head");
  const hasBody = html.includes("<body");

  // Reforçar estrutura mínima se necessário
  if (!hasDoctype || !hasHtml || !hasHead || !hasBody) {
    html = `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${userPrompt}</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://unpkg.com/boxicons@2.1.4/css/boxicons.min.css" rel="stylesheet" />
</head>
<body class="bg-gray-50">
  ${html}
</body>
</html>
    `.trim();
  }

  return html;
};
