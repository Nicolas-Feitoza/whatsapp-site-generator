export type TokenResponse = {
    access_token: string
    token_type: string
    expires_in?: number
  }
  
  export function assertValidTokenResponse(data: unknown): TokenResponse {
    if (
      typeof data === 'object' &&
      data !== null &&
      'access_token' in data &&
      typeof (data as any).access_token === 'string' &&
      'token_type' in data &&
      typeof (data as any).token_type === 'string'
    ) {
      return data as TokenResponse
    }
  
    throw new Error('Resposta da API não possui o formato esperado para token.')
  }
  