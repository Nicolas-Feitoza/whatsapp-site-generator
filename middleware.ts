import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

const allowedOrigins = [
  'http://localhost:3000',
  'https://*.vercel.app',
  'https://*.ngrok.io',
]

export function middleware(request: NextRequest) {
  const origin = request.headers.get('origin')
  const response = NextResponse.next()

  // Verifica se a origem está na lista de permitidas
  if (origin && allowedOrigins.some(allowed => {
    const regex = new RegExp(allowed.replace(/\*/g, '.*'))
    return regex.test(origin)
  })) {
    response.headers.set('Access-Control-Allow-Origin', origin)
  }

  // Headers padrão
  response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
  response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  response.headers.set('Access-Control-Allow-Credentials', 'true')

  // Resposta para preflight requests
  if (request.method === 'OPTIONS') {
    return new NextResponse(null, { 
      status: 200,
      headers: Object.fromEntries(response.headers)
    })
  }

  return response
}

export const config = {
  matcher: '/api/:path*',
}