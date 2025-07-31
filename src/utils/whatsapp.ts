import fetch from 'node-fetch';
import { assertValidTokenResponse } from './assertValidTokenResponse';

const PHONE_ID = process.env.WHATSAPP_PHONE_ID;
const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;

let cachedToken: string | null = null;
let tokenExpiry: number = 0;

async function refreshAccessToken(): Promise<void> {
  try {
    const res = await fetch('https://graph.facebook.com/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json'},
      body: JSON.stringify({
        grant_type: 'client_credentials',
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Token refresh failed: ${err}`);
    }

    const rawdata = await res.json();
    const data = assertValidTokenResponse(rawdata);
    cachedToken = data.access_token;
    tokenExpiry = Date.now() + ((data.expires_in || 3600) * 1000);
    console.log('[WHATSAPP] Token refreshed, expires at:', new Date(tokenExpiry));
  } catch (error) {
    console.error('[WHATSAPP] Token refresh error:', error);
    cachedToken = null;
    tokenExpiry = 0;
    throw error;
  }
}

async function getAccessToken(): Promise<string> {
  // Use cached token if valid
  if (cachedToken && Date.now() < tokenExpiry - 60000) {
    return cachedToken;
  }

  // Fallback to env token if refresh fails
  try {
    await refreshAccessToken();
    return cachedToken!;
  } catch (error) {
    console.error('[WHATSAPP] Using fallback token');
    return process.env.WHATSAPP_TOKEN || "";
  }
}

export const sendTextMessage = async (to: string, text: string) => {
  try {
    const token = await getAccessToken();
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
  if (!imageUrl.startsWith('http') || imageUrl.includes('localhost')) {
    imageUrl = 'https://via.placeholder.com/1280x720.png?text=Site+Preview';
  }
  try {
    const token = await getAccessToken();
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
  try {
    const token = await getAccessToken();
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