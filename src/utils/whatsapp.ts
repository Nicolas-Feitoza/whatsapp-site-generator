import fetch from 'node-fetch';

const PHONE_ID = process.env.WHATSAPP_PHONE_ID;

export const sendTextMessage = async (to: string, text: string) => {
  console.log(`[WHATSAPP] Enviando mensagem: ${text} para ${to}`);
  try {
    const response = await fetch(
      `https://graph.facebook.com/v17.0/${PHONE_ID}/messages`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.WHATSAPP_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to,
          type: 'text',
          text: { body: text },
        }),
      }
    );

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`WhatsApp API error: ${JSON.stringify(errorData)}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error('WhatsApp send error:', error);
    throw error;
  }
}

export const sendImageMessage = async (to: string, imageUrl: string) => {
  console.log(`[WHATSAPP] Enviando imagem: link=${imageUrl} para ${to}`);
  if (!imageUrl.startsWith('http') || imageUrl.includes('localhost')) {
    imageUrl = 'https://via.placeholder.com/1280x720.png?text=Site+Preview';
  }
  try {
    const response = await fetch(
      `https://graph.facebook.com/v17.0/${PHONE_ID}/messages`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.WHATSAPP_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to,
          type: 'image',
          image: { link: imageUrl, caption: 'Preview do seu site gerado' },
        }),
      }
    );

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`WhatsApp image error: ${JSON.stringify(errorData)}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error('WhatsApp image send error:', error);
    throw error;
  }
}

export const sendActionButtons = async (
  to: string,
  ids: ("gerar_site" | "editar_site" | "sair")[] = ["gerar_site", "editar_site"]
) => {
  console.log(`[WHATSAPP] Enviando botões: ${ids} para ${to}`);
  try {
    const titles: Record<string, string> = {
      gerar_site: "Gerar site",
      editar_site: "Editar site",
      sair: "Sair",
    };
    
    await fetch(`https://graph.facebook.com/v17.0/${PHONE_ID}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "interactive",
        interactive: {
          type: "button",
          body: { text: "Escolha uma opção:" },
          action: {
            buttons: ids.map((id) => ({
              type: "reply",
              reply: { id, title: titles[id] },
            })),
          },
        },
      }),
    });
  } catch (error) {
    console.error('WhatsApp buttons error:', error);
  }
};