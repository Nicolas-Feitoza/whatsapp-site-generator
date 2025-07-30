interface ValidationResult {
  isValid: boolean;
  reason?: string;
  suggestedPrompt?: string;
}

export function validateSitePrompt(prompt: string): ValidationResult {
  // Validação mínima
  const minimalPatterns = [
      /(site|página|web)/i,
      /(loja|blog|portfólio|negócio)/i,
      /(quero|preciso|fazer|criar).*(site|página)/i
  ];

  const isMinimalValid = minimalPatterns.some(p => p.test(prompt));
  
  if (prompt.trim().length < 10) {
      return {
          isValid: false,
          reason: "Mensagem muito curta. Por favor, descreva melhor seu site."
      };
  }

  if (prompt.trim().length >= 10 && isMinimalValid) {
      return { isValid: true };
  }

  // Validação avançada
  const keywords = [
      'site', 'página', 'web', 'loja', 'ecommerce', 'blog', 
      'portfólio', 'negócio', 'empresa', 'serviço'
  ];

  const hasKeyword = keywords.some(kw => 
      prompt.toLowerCase().includes(kw.toLowerCase())
  );

  if (!hasKeyword) {
      return {
          isValid: false,
          reason: "Não identifiquei que você quer criar um site. Por favor, diga algo como: 'Quero um site para minha loja de roupas'",
          suggestedPrompt: `Site para ${prompt}`
      };
  }

  return { isValid: true };
}