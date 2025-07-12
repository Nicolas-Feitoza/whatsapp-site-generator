import { supabase } from '@/utils/supabase'

export const captureThumbnail = async (siteUrl: string): Promise<string> => {
  try {
    // 1️⃣ Chama Microlink e valida JSON
    const apiUrl = `https://api.microlink.io?url=${encodeURIComponent(siteUrl)}&screenshot=true&meta=false`
    const apiRes = await fetch(apiUrl)
    const apiCT = apiRes.headers.get('content-type') || ''
    if (!apiRes.ok || !apiCT.includes('application/json')) {
      const errBody = await apiRes.text()
      throw new Error(`Microlink não retornou JSON: ${apiCT} – ${errBody.slice(0,100)}`)
    }
    const { data } = await apiRes.json() as { data: { screenshot: { url: string } } }
    const thumbnailUrl = data.screenshot.url
    if (!thumbnailUrl) throw new Error('Microlink não retornou data.screenshot.url')

    // 2️⃣ Faz download da imagem e valida o Content-Type
    const imageRes = await fetch(thumbnailUrl)
    const imgCT = imageRes.headers.get('content-type') || ''
    if (!imageRes.ok || !imgCT.startsWith('image/')) {
      const errBody = await imageRes.text()
      throw new Error(`Esperava imagem, recebi ${imgCT}: ${errBody.slice(0,100)}`)
    }
    const imageBuffer = Buffer.from(await imageRes.arrayBuffer())

    // 3️⃣ Upload no Supabase com visibilidade pública
    const fileName = `thumbnail-${Date.now()}.jpg`
    const { data: uploaded, error: uploadError } = await supabase.storage
      .from('thumbnails')
      .upload(fileName, imageBuffer, {
        contentType: imgCT,
        upsert: false,
        cacheControl: '3600',
        metadata: { visibility: 'public' }
      })
    if (uploadError) throw uploadError

    // 4️⃣ Retorna URL pública
    const { data: publicUrlData } = supabase.storage
      .from('thumbnails')
      .getPublicUrl(uploaded.path)

    if (!publicUrlData.publicUrl) {
      throw new Error('Não foi possível obter publicUrl do Supabase')
    }

    return publicUrlData.publicUrl

  } catch (error) {
    console.error('Thumbnail capture error:', error)
    throw new Error('Failed to generate thumbnail')
  }
}
