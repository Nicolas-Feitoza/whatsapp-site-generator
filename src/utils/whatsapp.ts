import fetch from 'node-fetch';
import { assertValidTokenResponse } from './assertValidTokenResponse';

const PHONE_ID = process.env.WHATSAPP_PHONE_ID;
const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;

// Cache simples em memória
let cachedToken: string | null = null;
let tokenExpiry: number = 0;

// Busca um novo token via Client Credentials e atualiza o cache
async function refreshAccessToken(): Promise<void> {
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
    throw new Error(`Erro ao obter token: ${err}`)
  }

  const rawdata = await res.json();
  const data = assertValidTokenResponse(rawdata);
  cachedToken = data.access_token;
  tokenExpiry = Math.floor(Date.now() / 1000) + (data.expires_in || 3600);
};

// Retorna um access token válido, renovado se estiver prestes a expirar.
async function getAccessToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);

  // Caso não houver token ou falter menos de 60s, renova
  if (!cachedToken || now >= tokenExpiry - 60) {
    await refreshAccessToken();
  }

  return cachedToken!;
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

    const data = await response.json();
    if (!response.ok) throw data;
    return data;
  } catch (error) {
    console.error('WhatsApp send error:', error)
    throw error
  }
}

export const sendImageMessage = async (to: string, imageUrl: string) => {
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
          image: {
            link: imageUrl,
            caption: 'Preview do seu site gerado',
          },
        }),
      }
    );

    const data = await response.json();
    if (!response.ok) throw data;
    return data
  } catch (error) {
    console.error('WhatsApp image send error:', error)
    throw error
  }
}

export const sendActionButtons = async (to: string) => {
  try {
    console.log('📋 Enviando botões de ação para:', to)
    await fetch(`https://graph.facebook.com/v17.0/${PHONE_ID}/messages`, {
      method: 'POST',
      headers: { 
        'Authorization': `Bearer ${process.env.WHATSAPP_TOKEN}`, 
        'Content-Type': 'application/json' 
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'interactive',
        interactive: {
          type: 'button',
          body: { text: 'O que você deseja fazer?' },
          action: {
            buttons: [
              { type: 'reply', reply: { id: 'gerar_site', title: 'Gerar site' } },
              { type: 'reply', reply: { id: 'editar_site', title: 'Editar site' } }
            ]
          }
        }
      })
    })
    
  } catch (error) {
    console.error('❌ sendActionButtons error:', error)
    throw error
  }
}
