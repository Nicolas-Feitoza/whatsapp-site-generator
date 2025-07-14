import { NextResponse } from 'next/server'
import { supabase } from '@/utils/supabase'
import { generateTemplate } from '@/utils/aiClient'
import { getOrCreateProjectId, deployOnVercel } from '@/utils/vercelDeploy'
import { sendImageMessage, sendTextMessage } from '@/utils/whatsapp'
import { captureWithPageSpeed } from '@/utils/thumbnail'

interface RequestBody {
  id: string
}

export async function POST(request: Request) {
  let requestId: string | undefined

  try {
    // 1️⃣ Ler ID da requisição
    const { id } = (await request.json()) as RequestBody
    requestId = id
    console.log('📥 Deploy request for ID:', id)

    if (!id) {
      console.warn('⚠️ ID is required')
      return NextResponse.json({ error: 'ID is required' }, { status: 400 })
    }

    // 2️⃣ Verificar status atual e evitar duplicação
    const { data: reqRow, error: statusFetchError } = await supabase
      .from('requests')
      .select('status')
      .eq('id', id)
      .single()

    if (statusFetchError || !reqRow) {
      console.error('❌ Could not fetch request status:', statusFetchError)
      return NextResponse.json({ error: 'Request not found' }, { status: 404 })
    }

    // Se já estiver em processamento ou concluído, não re-executa o fluxo
    if (reqRow.status !== 'pending') {
      console.log('💡 Deploy already in progress or done, skipping.')
      return NextResponse.json({ success: true })
    }

    // 3️⃣ Marcar como processing
    await supabase
      .from('requests')
      .update({ status: 'processing', updated_at: new Date().toISOString() })
      .eq('id', id)

    // 4️⃣ Buscar dados da requisição
    const { data: siteRequest, error: fetchError } = await supabase
      .from('requests')
      .select('*')
      .eq('id', id)
      .single()

    if (fetchError || !siteRequest) {
      console.error('❌ Request not found after marking processing:', fetchError)
      throw new Error('Request not found')
    }

    console.log('📝 Prompt do usuário:', siteRequest.prompt)

    // 5️⃣ Gerar código HTML
    const templateCode = await generateTemplate(siteRequest.prompt)
    console.log('🧠 Template gerado, tamanho:', templateCode.length)

    // 6️⃣ Obter ou criar projeto Vercel
    const projectId = await getOrCreateProjectId(siteRequest.user_phone)

    // 7️⃣ Fazer deploy no Vercel
    const { url: vercelUrl } = await deployOnVercel(
      templateCode,
      projectId,
      siteRequest.user_phone
    )
    
    // 8️⃣ Gerar thumbnail
    const thumbnailUrl = await captureWithPageSpeed(vercelUrl)
    console.log('📸 Thumbnail criada:', thumbnailUrl)

    // 9️⃣ Atualizar registro como completed
    const { error: updateError } = await supabase
      .from('requests')
      .update({
        status: 'completed',
        vercel_url: vercelUrl,
        thumbnail_url: thumbnailUrl,
        project_id: projectId,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)

    if (updateError) {
      console.error('❌ Erro ao atualizar request como completed:', updateError)
      throw updateError
    }

    console.log('✅ Registro atualizado, enviando mensagens...')

    // 🔟 Enviar mensagens ao usuário
    await sendImageMessage(siteRequest.user_phone, thumbnailUrl)
    await sendTextMessage(
      siteRequest.user_phone,
      `✅ Seu site está pronto!\n\n🌐 Acesse: ${vercelUrl}\n\n⚠️ Link válido por 24 horas!`
    )

    return NextResponse.json({ success: true })

  } catch (error: unknown) {
    console.error('🔥 Deploy error:', error)

    // Marcar como failed se tivermos o ID
    if (requestId) {
      console.log('⚠️ Marcando request como failed:', requestId)
      await supabase
        .from('requests')
        .update({ status: 'failed', updated_at: new Date().toISOString() })
        .eq('id', requestId)

      // Notificar usuário
      const { data: failedReq } = await supabase
        .from('requests')
        .select('user_phone')
        .eq('id', requestId)
        .single()

      if (failedReq?.user_phone) {
        await sendTextMessage(
          failedReq.user_phone,
          '❌ Ocorreu um erro ao gerar seu site. Estamos melhorando nosso sistema!'
        )
      }
    }

    const msg = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
