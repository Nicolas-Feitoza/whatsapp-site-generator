import { NextResponse } from 'next/server'
import { supabase } from '@/utils/supabase'
import { generateTemplate } from '@/utils/aiClient'
import { deployOnVercel } from '@/utils/vercelDeploy'
import { captureThumbnail } from '@/utils/thumbnail'
import { sendImageMessage, sendTextMessage } from '@/utils/whatsapp'
import { RequestType } from '@/types/types'

interface RequestBody {
  id: string
}

export async function POST(request: Request) {
  try {
    // Extrair id do corpo da requisição com tipagem segura
    const requestBody: RequestBody = await request.json()
    const { id } = requestBody

    if (!id) {
      return NextResponse.json(
        { error: 'ID is required' },
        { status: 400 }
      )
    }

    // Buscar pedido no Supabase com tipagem explícita
    const { data: siteRequest, error: fetchError } = await supabase
      .from('requests')
      .select('*')
      .eq('id', id)
      .single()

    if (!siteRequest || fetchError) {
      return NextResponse.json(
        { error: 'Request not found' },
        { status: 404 }
      )
    }

    // Gerar código com IA
    const templateCode = await generateTemplate(siteRequest.prompt)
    
    // Fazer deploy na Vercel
    const vercelUrl = await deployOnVercel(templateCode)
    
    // Gerar thumbnail
    const thumbnailUrl = await captureThumbnail(vercelUrl)
    
    // Atualizar registro
    const { error: updateError } = await supabase
      .from('requests')
      .update({
        status: 'completed',
        vercel_url: vercelUrl,
        thumbnail_url: thumbnailUrl,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)

    if (updateError) throw updateError

    // Enviar resultado via WhatsApp
    await sendImageMessage(siteRequest.user_phone, thumbnailUrl)
    await sendTextMessage(
      siteRequest.user_phone, 
      `✅ Seu site está pronto!\n\n🌐 Acesse: ${vercelUrl}\n\n⚠️ Link válido por 24 horas!`
    )

    return NextResponse.json({ success: true })

  } catch (error: unknown) {
    console.error('Deploy error:', error)
    
    // Extrair id do erro de forma segura
    let requestId: string | undefined
    try {
      const errorBody = await request.json()
      requestId = errorBody.id
    } catch (e) {
      console.error('Failed to parse error request:', e)
    }

    if (requestId) {
      // Atualizar status de erro
      await supabase
        .from('requests')
        .update({ status: 'failed' })
        .eq('id', requestId)

      // Notificar usuário
      const { data: failedRequest } = await supabase
        .from('requests')
        .select('user_phone')
        .eq('id', requestId)
        .single()

      if (failedRequest?.user_phone) {
        await sendTextMessage(
          failedRequest.user_phone, 
          "❌ Ocorreu um erro ao gerar seu site. Estamos melhorando nosso sistema!"
        )
      }
    }

    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    )
  }
}

export const dynamic = 'force-dynamic'