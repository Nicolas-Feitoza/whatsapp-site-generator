import { supabase } from '@/utils/supabase';

export const config = {
    schedule: '0 * * * *' // Executa a cada 1 hora
}
  

export async function GET() {
  const now = Date.now()

  const { data: requests } = await supabase
    .from('requests')
    .select('id, project_id, updated_at')
    .eq('status', 'completed')

    if (!requests) {
    return new Response('Nenhuma solicitação encontrada', { status: 404 })
    }

  const expired = requests.filter(r => {
    const updatedAt = new Date(r.updated_at).getTime()
    return now - updatedAt > 60 * 60 * 1000 // 60 min
  })

  for (const req of expired) {
    console.log('🗑️ Deletando projeto:', req.project_id)
    await fetch(`https://api.vercel.com/v9/projects/${req.project_id}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${process.env.VERCEL_TOKEN}`
      }
    })

    await supabase.from('requests').update({ status: 'expired' }).eq('id', req.id)
  }

  return new Response(`Limpeza concluída: ${expired.length} projetos removidos`, { status: 200 })
}
