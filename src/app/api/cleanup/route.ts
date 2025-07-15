import { supabase } from '@/utils/supabase';

export const config = {
    schedule: '0 * * * *'
}

export async function GET() {
  const now = Date.now();
  const { data: requests } = await supabase
    .from('requests')
    .select('id, project_id, updated_at')
    .eq('status', 'completed');

  if (!requests) {
    return new Response('Nenhuma solicitação encontrada', { status: 404 });
  }

  const expired = requests.filter(r => {
    const updatedAt = new Date(r.updated_at).getTime();
    return now - updatedAt > 60 * 60 * 1000;
  });

  for (const req of expired) {
    if (!req.project_id) continue;

    // Check for active requests
    const { count: activeCount } = await supabase
      .from('requests')
      .select('*', { count: 'exact' })
      .eq('project_id', req.project_id)
      .neq('status', 'expired');

    if (activeCount === 0) {
      console.log('🗑️ Deletando projeto:', req.project_id);
      await fetch(`https://api.vercel.com/v9/projects/${req.project_id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${process.env.VERCEL_TOKEN}` }
      }).catch(err => console.error('Erro ao deletar projeto:', err));
    }

    await supabase
      .from('requests')
      .update({ status: 'expired' })
      .eq('id', req.id);
  }

  return new Response(`Limpeza concluída: ${expired.length} projetos removidos`, { status: 200 });
}