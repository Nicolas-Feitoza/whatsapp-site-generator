import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '@/app/utils/supabase';
import { deployOnVercel } from '@/app/utils/vercelDeploy';
import { captureThumbnail } from '@/app/utils/thumbnail';
import { sendImageMessage, sendTextMessage } from '@/app/utils/whatsapp';
import { RequestType } from '@/app/types/types';
import { generateTemplate } from '@/app/utils/aiClient';
import { applyCors } from '@/app/utils/cors';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const isPreflight = applyCors(req, res);
  if (isPreflight) return;
  const { id } = req.query;

  try {
    // Buscar pedido no Supabase
    const { data: request, error } = await supabase
      .from('requests')
      .select('*')
      .eq('id', id as string)
      .single();

    if (!request) {
      return res.status(404).json({ error: 'Request not found' });
    }

    // Gerar código com IA
    const templateCode = await generateTemplate(request.prompt);
    console.log('Código gerado:', templateCode.substring(0, 100) + '...');
    
    // Fazer deploy na Vercel
    const vercelUrl = await deployOnVercel(templateCode);
    
    // Gerar thumbnail
    const thumbnailUrl = await captureThumbnail(vercelUrl);
    
    // Atualizar registro
    await supabase
      .from('requests')
      .update({
        status: 'completed',
        vercel_url: vercelUrl,
        thumbnail_url: thumbnailUrl,
        updated_at: new Date().toISOString()
      })
      .eq('id', id);

    // Enviar resultado via WhatsApp
    await sendImageMessage(request.user_phone, thumbnailUrl);
    await sendTextMessage(
      request.user_phone, 
      `✅ Seu site está pronto!\n\n🌐 Acesse: ${vercelUrl}\n\n⚠️ Link válido por 24 horas!`
    );

    res.status(200).json({ success: true });
  } catch (error: any) {
    console.error('Deploy error:', error);
    
    // Atualizar status de erro
    await supabase
      .from('requests')
      .update({ status: 'failed' })
      .eq('id', id);

    // Notificar usuário
    const request = await supabase
      .from('requests')
      .select('user_phone')
      .eq('id', id)
      .single();

    if (request.data) {
      await sendTextMessage(
        request.data.user_phone, 
        "❌ Ocorreu um erro ao gerar seu site. Estamos melhorando nosso sistema!"
      );
    }

    res.status(500).json({ error: error.message || 'Generation failed' });
  }
}