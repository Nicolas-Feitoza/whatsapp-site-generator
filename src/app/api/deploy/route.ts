import { NextResponse } from 'next/server'
import { supabase } from '@/utils/supabase'
import { generateTemplate } from '@/utils/aiClient'
import { deployOnVercel } from '@/utils/vercelDeploy'
import { captureThumbnail } from '@/utils/thumbnail'
import { sendImageMessage, sendTextMessage } from '@/utils/whatsapp'

interface RequestBody {
  id: string
}

export async function POST(request: Request) {
  try {
    const { id } = (await request.json()) as RequestBody
    console.log('📥 Deploy request for ID:', id)

    if (!id) {
      console.warn('⚠️ ID is required')
      return NextResponse.json({ error: 'ID is required' }, { status: 400 })
    }

    // Buscar pedido
    const { data: siteRequest, error: fetchError } = await supabase
      .from('requests')
      .select('*')
      .eq('id', id)
      .single()

    if (fetchError || !siteRequest) {
      console.error('❌ Request not found:', fetchError)
      return NextResponse.json({ error: 'Request not found' }, { status: 404 })
    }

    console.log('📝 Prompt do usuário:', siteRequest.prompt)

    // Gerar código
    const templateCode = await generateTemplate(siteRequest.prompt)
    console.log('🧠 Template gerado, tamanho:', templateCode.length)

    // Deploy na Vercel (reaproveita project_id se existir)
    const { url: vercelUrl, projectId } = await deployOnVercel(
      templateCode,
      (siteRequest as any).project_id // assumindo que você adicionou a coluna project_id
    )

    // Gerar thumbnail
    const thumbnailUrl = await captureThumbnail(vercelUrl)
    console.log('📸 Thumbnail criada:', thumbnailUrl)

    // Atualizar registro no Supabase
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
      console.error('❌ Erro ao atualizar registro:', updateError)
      throw updateError
    }

    console.log('✅ Registro atualizado, enviando mensagens...')

    // Enviar resultado
    await sendImageMessage(siteRequest.user_phone, thumbnailUrl)
    await sendTextMessage(
      siteRequest.user_phone,
      `✅ Seu site está pronto!\n\n🌐 Acesse: ${vercelUrl}\n\n⚠️ Link válido por 24 horas!`
    )

    return NextResponse.json({ success: true })
  } catch (error: unknown) {
    console.error('🔥 Deploy error:', error)

    // Tentar extrair ID para marcar falha
    let requestId: string | undefined
    try {
      const body = await request.json()
      requestId = (body as RequestBody).id
    } catch {
      console.error('❌ Failed to parse error request body')
    }

    if (requestId) {
      console.log('⚠️ Marcando request como failed:', requestId)
      await supabase.from('requests').update({ status: 'failed' }).eq('id', requestId)

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
