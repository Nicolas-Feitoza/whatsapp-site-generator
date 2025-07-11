import { NextResponse } from 'next/server'
import { supabase } from '@/utils/supabase'
import { sendActionButtons, sendTextMessage } from '@/utils/whatsapp'
import { RequestType } from '@/types/types'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  
  // Parâmetros da Meta para verificação do webhook
  const mode = searchParams.get('hub.mode')
  const token = searchParams.get('hub.verify_token')
  const challenge = searchParams.get('hub.challenge')

  // Verificação do webhook
  if (
    mode === 'subscribe' && 
    token === process.env.WHATSAPP_VERIFY_TOKEN
  ) {
    return new NextResponse(challenge, { status: 200 })
  }

  return new NextResponse('Verification failed', { status: 403 })
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    console.log('📥 Webhook body recebido:', JSON.stringify(body, null, 2))

    const entry = body.entry?.[0]
    if (!entry) {
      console.warn('⚠️ Entrada ausente no body:', JSON.stringify(body))
      return NextResponse.json(
        { error: "Invalid request format" },
        { status: 400 }
      )
    }

    const change = entry.changes?.[0]
    const value = change.value as any
    // ── Filtrar status updates (sent/read/etc) ──
    if (value.statuses) {
      console.log('📈 Status update recebido, ignorando:', JSON.stringify(value.statuses))
      return NextResponse.json({}, { status: 200 })
    }
    // ── a) Botão “Gerar” / “Editar” ──
    if (value.messages?.[0]?.interactive) {
      const btnId = value.messages[0].interactive.button_reply.id  // 'gerar_site' ou 'editar_site'
      const action = btnId === 'editar_site' ? 'editar' : 'gerar'
      const userPhone = value.contacts[0].wa_id

      console.log(`🔘 Botão clicado por ${userPhone}:`, action)
      await supabase
        .from('sessions')
        .upsert({ user_phone: userPhone, action })

      await sendTextMessage(
        userPhone,
        action === 'editar'
          ? '✏️ O que você quer editar no seu site existente?'
          : '✏️ Envie o texto do site que deseja gerar.'
      )
      return NextResponse.json({}, { status: 200 })
    }
    const message = value.messages?.[0]?.text
    const userPhone = value.messages?.[0]?.from
    const rawText   = message?.body || ''

    
    if (!message) {
      console.warn('⚠️ Nenhuma mensagem encontrada:', JSON.stringify(change))
      return NextResponse.json(
        { error: "No message found" },
        { status: 400 }
      )
    }

    console.log(`📲 Mensagem recebida de ${userPhone}: "${rawText}"`)

    if (!rawText) {
      console.warn('⚠️ Mensagem sem texto:', JSON.stringify(message))
      return NextResponse.json(
        { error: "No text in message" },
        { status: 400 }
      )
    }

    // ── b) Buscar sessão ativa ──
    const { data: session } = await supabase
    .from('sessions')
    .select('action')
    .eq('user_phone', userPhone)
    .single()

    if (!session) {
    console.log('⚠️ Sem sessão para', userPhone, '-- reenviando botões')
    await sendActionButtons(userPhone)
    return NextResponse.json({}, { status: 200 })
    }


    if (!isValidSiteRequest(rawText)) {
      console.log(`❌ Solicitação inválida de ${userPhone}: "${rawText}"`)
      await sendTextMessage(userPhone, "❌ Eu só posso criar sites! Tente algo como:\n\"Quero um site para minha loja de roupas\"\n\"Preciso de um portfolio profissional\"")
      return NextResponse.json(
        { error: "Invalid request type" },
        { status: 400 }
      )
    }

    console.log('💾 Salvando solicitação no Supabase...')
    // ── c) Determinar project_id para editar ──
    let projectId: string | undefined
    if (session.action === 'editar') {
      const { data: lastReq } = await supabase
        .from('requests')
        .select('project_id')
        .eq('user_phone', userPhone)
        .order('created_at', { ascending: false })
        .limit(1)
        .single()
      projectId = lastReq?.project_id ?? undefined
    }

    // Inserir no Supabase
    const { data, error } = await supabase
      .from('requests')
      .insert([{
        user_phone: userPhone,
        prompt: rawText,
        status: 'pending',
        project_id: projectId
      }])
      .select()
      .single()

    if (error) {
      console.error('❌ Erro ao salvar no Supabase:', error)
      throw error
    }

    console.log('✅ Solicitação salva com ID:', data.id)

    await sendTextMessage(userPhone, "⌛ Gerando seu site profissional... Isso pode levar até 1 minuto!")
    
    console.log('🚀 Iniciando processamento assíncrono...')
    await processRequestAsync(data.id)

    // ── d) Limpar a sessão ──
    await supabase
    .from('sessions')
    .delete()
    .eq('user_phone', userPhone)

    return NextResponse.json({ status: 'processing' })

  } catch (error) {
    console.error('🔥 Webhook error:', error instanceof Error ? error.message : JSON.stringify(error))
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

function isValidSiteRequest(prompt: string): boolean {
  const keywords = ["site", "página", "web", "landing page", "portfolio", "loja online", "e-commerce"]
  return keywords.some(keyword => prompt.toLowerCase().includes(keyword))
}

async function processRequestAsync(requestId: string) {
  try {
    // Simular delay para demonstração
    await new Promise(resolve => setTimeout(resolve, 3000))
    
    // Chamar endpoint de processamento
    await fetch(`${process.env.BASE_URL}/api/deploy`, {
      method: 'POST',
      body: JSON.stringify({ id: requestId }),
      headers: { 'Content-Type': 'application/json' }
    })
  } catch (error) {
    console.error('Async processing error:', error)
  }
}

export const dynamic = 'force-dynamic'