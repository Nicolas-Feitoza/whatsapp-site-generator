interface ValidationResult {
    isValid: boolean;
    reason?: string;
    suggestedPrompt?: string;
  }
  
  export function validateSitePrompt(prompt: string): ValidationResult {
    if (prompt.trim().length < 10) {
      return {
        isValid: false,
        reason: "Mensagem muito curta. Por favor, descreva melhor seu site."
      };
    }
  
    // Lista expandida e normalizada de palavras-chave
    const keywords = [
      // Tipos de sites
      'site', 'pagina', 'página', 'web', 'landing page', 'lp', 'homepage',
      'portfolio', 'vitrine', 'one page', 'single page',
      
      // Finalidades
      'loja', 'ecommerce', 'e-commerce', 'blog', 'institucional', 
      'empresa', 'negocio', 'negócio', 'serviço', 'servico',
      'comercial', 'vendas', 'cardapio', 'cardápio', 'catalogo', 'catálogo',
      
      // Tecnologias (caso queira permitir)
      'html', 'css', 'react', 'wordpress'
    ];
  
    // Expressões regulares para padrões comuns
    const patterns = [
      /(?:criar|fazer|desenvolver|construir|preciso|quero)\s+(?:um|uma|o|a)?\s*(site|página|web)/i,
      /(?:site|página)\s+(?:para|de)\s+/i,
      /(?:ter|ter um|ter uma)\s+(?:site|homepage|landing page)/i
    ];
  
    // Normaliza o prompt para comparação
    const normalized = prompt
      .toLowerCase()
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // remove acentos
      .replace(/[^\w\s]/g, ' '); // remove pontuação
  
    // Verifica palavras-chave
    const hasKeyword = keywords.some(keyword => 
      normalized.includes(keyword.toLowerCase())
    );
  
    // Verifica padrões
    const hasPattern = patterns.some(pattern => pattern.test(prompt));
  
    // Se não encontrou nenhum indicador
    if (!hasKeyword && !hasPattern) {
      return {
        isValid: false,
        reason: "Não identifiquei que você quer criar um site. Por favor, diga algo como: 'Quero um site para minha loja de roupas' ou 'Preciso de uma página para meu restaurante'.",
        suggestedPrompt: `Site para ${prompt}`
      };
    }
  
    return { isValid: true };
  }