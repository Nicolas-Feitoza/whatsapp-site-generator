import { supabase } from '@/utils/supabase'

export const captureThumbnail = async (siteUrl: string): Promise<string> => {
  try {
    // 1️⃣ Gerar imagem via Microlink
    const response = await fetch(`https://api.microlink.io?url=${encodeURIComponent(siteUrl)}&screenshot=true&meta=false&embed=screenshot.url`)
    const data = await response.json()

    const thumbnailUrl = data?.data?.screenshot?.url
    if (!thumbnailUrl) throw new Error('Thumbnail not found')
    console.log('📸 Thumbnail temporária gerada:', thumbnailUrl)

    // 2️⃣ Baixar imagem como buffer
    const imageRes = await fetch(thumbnailUrl)
    const imageBuffer = await imageRes.arrayBuffer()

    // 3️⃣ Upload no Supabase com visibilidade pública
    const fileName = `thumbnail-${Date.now()}.jpg`
    const { data: uploaded, error: uploadError } = await supabase.storage
      .from('thumbnails')
      .upload(fileName, imageBuffer, {
        contentType: 'image/jpeg',
        upsert: false,
        cacheControl: '3600',
        metadata: { visibility: 'public' } // 👈 aqui está o segredo!
      })

    if (uploadError) throw uploadError

    // 4️⃣ Obter URL pública
    const { data: publicUrlData } = supabase.storage
      .from('thumbnails')
      .getPublicUrl(uploaded.path)

    console.log('🖼️ Thumbnail salva no Supabase:', publicUrlData.publicUrl)
    return publicUrlData.publicUrl
  } catch (error) {
    console.error('Thumbnail capture error:', error)
    throw new Error('Failed to generate thumbnail')
  }
}
