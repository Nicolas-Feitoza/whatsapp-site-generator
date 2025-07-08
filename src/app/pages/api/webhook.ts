import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '@/app/utils/supabase';
import { sendTextMessage } from '@/app/utils/whatsapp';
import { RequestType } from '@/app/types/types';
import { applyCors } from '@/app/utils/cors';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const isPreflight = applyCors(req, res);
  if (isPreflight) return;
  if (req.method === 'GET') {
    // Validação do webhook
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (
      mode === 'subscribe' && 
      token === process.env.WHATSAPP_VERIFY_TOKEN
    ) {
      return res.status(200).send(challenge);
    } else {
      return res.status(403).end();
    }
  }
  if (req.method === 'POST') {
    try {
      const entry = req.body.entry[0];
      const change = entry.changes[0];
      const message = change.value.messages[0];
      
      const userPhone = message.from;
      const userPrompt = message.text.body;

      // Validar se é uma solicitação de site
      if (!isValidSiteRequest(userPrompt)) {
        await sendTextMessage(userPhone, "❌ Eu só posso criar sites! Tente algo como:\n\"Quero um site para minha loja de roupas\"\n\"Preciso de um portfolio profissional\"");
        return res.status(400).json({ error: "Invalid request type" });
      }

      // Salvar no Supabase
      const { data, error } = await supabase
        .from('requests')
        .insert([{
          user_phone: userPhone,
          prompt: userPrompt,
          status: 'pending'
        }])
        .select()
        .single();

      if (error) throw error;

      // Responder imediatamente
      await sendTextMessage(userPhone, "⌛ Gerando seu site profissional... Isso pode levar até 1 minuto!");
      
      // Iniciar processamento assíncrono
      processRequestAsync(data.id);

      res.status(200).json({ status: 'processing' });
    } catch (error) {
      console.error('Webhook error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  } else {
    res.setHeader('Allow', ['POST']);
    res.status(405).end('Method Not Allowed');
  }
}

// Validar solicitação do usuário
const isValidSiteRequest = (prompt: string): boolean => {
  const keywords = ["site", "página", "web", "landing page", "portfolio", "loja online", "e-commerce"];
  return keywords.some(keyword => prompt.toLowerCase().includes(keyword));
};

// Processar em segundo plano
const processRequestAsync = async (requestId: string) => {
  try {
    // Simular delay para demonstração
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Chamar endpoint de processamento
    await fetch(`${process.env.BASE_URL}/api/deploy?id=${requestId}`);
  } catch (error) {
    console.error('Async processing error:', error);
  }
};