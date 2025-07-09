import { NextResponse } from 'next/server'
import { supabase } from '@/utils/supabase'
import { sendTextMessage } from '@/utils/whatsapp'
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
    const entry = body.entry?.[0]
    if (!entry) {
      return NextResponse.json(
        { error: "Invalid request format" },
        { status: 400 }
      )
    }

    const change = entry.changes?.[0]
    const message = change?.value?.messages?.[0]
    
    if (!message) {
      return NextResponse.json(
        { error: "No message found" },
        { status: 400 }
      )
    }

    const userPhone = message.from
    const userPrompt = message.text?.body

    if (!userPrompt) {
      return NextResponse.json(
        { error: "No text in message" },
        { status: 400 }
      )
    }

    // Validar se é uma solicitação de site
    if (!isValidSiteRequest(userPrompt)) {
      await sendTextMessage(userPhone, "❌ Eu só posso criar sites! Tente algo como:\n\"Quero um site para minha loja de roupas\"\n\"Preciso de um portfolio profissional\"")
      return NextResponse.json(
        { error: "Invalid request type" },
        { status: 400 }
      )
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
      .single()

    if (error) throw error

    // Responder imediatamente
    await sendTextMessage(userPhone, "⌛ Gerando seu site profissional... Isso pode levar até 1 minuto!")
    
    // Iniciar processamento assíncrono
    processRequestAsync(data.id)

    return NextResponse.json({ status: 'processing' })

  } catch (error) {
    console.error('Webhook error:', error)
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