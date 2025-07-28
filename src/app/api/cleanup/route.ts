import { supabase } from '@/utils/supabase';
import { NextResponse } from 'next/server';

// Configurações ajustáveis
const CLEANUP_SETTINGS = {
  expirationTime: 24 * 60 * 60 * 1000, // 24 horas em ms
  batchSize: 10, // Número máximo de projetos para processar por execução
  retryCount: 3, // Tentativas de exclusão
  retryDelay: 2000 // Delay entre tentativas em ms
};

export const config = {
  schedule: '0 * * * *' // Executa a cada hora
};

export async function GET() {
  try {
    const now = Date.now();
    console.log(`[CLEANUP] 🧹 Iniciando limpeza em ${new Date(now).toISOString()}`);

    // 1. Buscar requests elegíveis para limpeza
    const { data: requests, error: fetchError } = await supabase
      .from('requests')
      .select('id, project_id, updated_at, status, user_phone')
      .in('status', ['completed', 'failed'])
      .not('project_id', 'is', null)
      .order('updated_at', { ascending: true }) // Mais antigos primeiro
      .limit(CLEANUP_SETTINGS.batchSize);

    if (fetchError) throw fetchError;
    if (!requests || requests.length === 0) {
      console.log('[CLEANUP] ✅ Nenhum projeto elegível para limpeza');
      return NextResponse.json({ message: 'Nenhum projeto para limpar' }, { status: 200 });
    }

    console.log(`[CLEANUP] 🔍 Encontrados ${requests.length} projetos para verificação`);

    // 2. Filtrar projetos expirados
    const expired = requests.filter(r => {
      const updatedAt = new Date(r.updated_at).getTime();
      return now - updatedAt > CLEANUP_SETTINGS.expirationTime;
    });

    if (expired.length === 0) {
      console.log('[CLEANUP] ⏳ Nenhum projeto expirado encontrado');
      return NextResponse.json({ message: 'Nenhum projeto expirado' }, { status: 200 });
    }

    console.log(`[CLEANUP] 🗑️ ${expired.length} projetos expirados encontrados`);

    // 3. Processar limpeza com resiliência
    const results = await processCleanupBatch(expired);

    // 4. Atualizar status no Supabase
    await updateRequestStatuses(results);

    // 5. Relatório final
    const successCount = results.filter(r => r.success).length;
    const failedCount = results.filter(r => !r.success).length;

    console.log(`[CLEANUP] 🎉 Limpeza concluída: ${successCount} sucessos, ${failedCount} falhas`);

    return NextResponse.json({
      message: 'Limpeza concluída',
      cleaned: successCount,
      failed: failedCount,
      details: results
    }, { status: 200 });

  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[CLEANUP] 🔴 Erro durante a limpeza:', message);
    return NextResponse.json(
      { error: 'Erro durante a limpeza', details: message },
      { status: 500 }
    );
  }
}

// Função auxiliar para processar em batch com resiliência
async function processCleanupBatch(requests: any[]) {
  const results = [];

  for (const req of requests) {
    let attempt = 0;
    let success = false;
    let error = null;

    // Verificar se há requests ativas para este projeto
    const { count: activeCount } = await supabase
      .from('requests')
      .select('*', { count: 'exact' })
      .eq('project_id', req.project_id)
      .not('status', 'in', '("expired", "failed")');

      if ((activeCount ?? 0) > 0) {
        // Se for null, trata como zero
        results.push({
          requestId: req.id,
          projectId: req.project_id,
          success: false,
          reason: 'Projeto tem requests ativas'
        });
        continue;
      }      

    // Tentar deletar com retry
    while (attempt < CLEANUP_SETTINGS.retryCount && !success) {
      attempt++;
      try {
        console.log(`[CLEANUP] 🚀 Tentativa ${attempt} para ${req.project_id}`);

        // Verificar se o projeto existe antes de deletar
        const projectExists = await checkProjectExists(req.project_id);
        if (!projectExists) {
          success = true;
          error = 'Projeto não existe na Vercel';
          break;
        }

        await deleteVercelProject(req.project_id);
        success = true;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        error = message;
      
        if (attempt < CLEANUP_SETTINGS.retryCount) {
          await new Promise(r => setTimeout(r, CLEANUP_SETTINGS.retryDelay));
        }
      }
      
    }

    results.push({
      requestId: req.id,
      projectId: req.project_id,
      success,
      attempt,
      error: error || undefined
    });
  }

  return results;
}

// Verifica se o projeto existe na Vercel
async function checkProjectExists(projectId: string): Promise<boolean> {
  try {
    const response = await fetch(`https://api.vercel.com/v9/projects/${projectId}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${process.env.VERCEL_TOKEN}` }
    });

    if (response.status === 404) return false;
    if (!response.ok) throw new Error(`Vercel API error: ${response.status}`);

    return true;
  } catch (error) {
    console.error(`[CLEANUP] 🔴 Erro ao verificar projeto ${projectId}:`, error);
    throw error;
  }
}

// Deleta projeto na Vercel
async function deleteVercelProject(projectId: string): Promise<void> {
  const response = await fetch(`https://api.vercel.com/v9/projects/${projectId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${process.env.VERCEL_TOKEN}` }
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Falha ao deletar projeto: ${error}`);
  }

  console.log(`[CLEANUP] ✅ Projeto ${projectId} deletado com sucesso`);
}

// Atualiza status dos requests no Supabase
async function updateRequestStatuses(results: any[]) {
  const updates = results.map(r => ({
    id: r.requestId,
    status: r.success ? 'expired' : 'cleanup_failed',
    cleanup_attempts: r.attempt,
    ...(r.error ? { cleanup_error: r.error } : {})
  }));

  const { error } = await supabase
    .from('requests')
    .upsert(updates);

  if (error) {
    console.error('[CLEANUP] 🔴 Erro ao atualizar status:', error);
    throw error;
  }
}