export interface RequestType {
  id: string
  user_phone: string
  prompt: string
  status: 'pending' | 'processing' | 'completed' | 'failed'
  vercel_url?: string
  thumbnail_url?: string
  created_at: string
  updated_at: string
}