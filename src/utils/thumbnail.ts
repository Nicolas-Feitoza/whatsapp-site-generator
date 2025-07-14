import { supabase } from '@/utils/supabase'

export const captureThumbnail = async (siteUrl: string): Promise<string> => {
  try {
    // 1️⃣ Gerar screenshot via Microlink e validar JSON
    const apiUrl = `https://api.microlink.io?url=${encodeURIComponent(siteUrl)}&screenshot=true&meta=false`
    const apiRes = await fetch(apiUrl)
    const apiCT = apiRes.headers.get('content-type') || ''
    if (!apiRes.ok || !apiCT.includes('application/json')) {
      const text = await apiRes.text()
      throw new Error(`Microlink retornou ${apiCT}: ${text.slice(0, 100)}`)
    }
    const { data } = (await apiRes.json()) as { data: { screenshot: { url: string } } }
    const thumbnailUrl = data.screenshot.url
    if (!thumbnailUrl) throw new Error('Microlink não retornou data.screenshot.url')

    // 2️⃣ Baixar a imagem e validar content-type
    const imageRes = await fetch(thumbnailUrl)
    const imgCT = imageRes.headers.get('content-type') || ''
    if (!imageRes.ok || !imgCT.startsWith('image/')) {
      const text = await imageRes.text()
      throw new Error(`Esperava imagem, recebi ${imgCT}: ${text.slice(0, 100)}`)
    }
    const buffer = Buffer.from(await imageRes.arrayBuffer())

    // 3️⃣ Upload para Supabase e criar Signed URL de 1 hora
    const fileName = `thumbnail-${Date.now()}.jpg`
    const { data: uploadData, error: uploadErr } = await supabase.storage
      .from('thumbnails')
      .upload(fileName, buffer, {
        contentType: imgCT,
        cacheControl: '3600',
        upsert: false,
        metadata: { visibility: 'public' }
      })
    if (uploadErr) throw uploadErr

    const { data: signedData, error: signedErr } = await supabase.storage
      .from('thumbnails')
      .createSignedUrl(uploadData.path, 60 * 60)
    if (signedErr || !signedData.signedUrl) throw signedErr || new Error('Falha ao gerar Signed URL')

    return signedData.signedUrl

  } catch (error) {
    console.error('Thumbnail capture error:', error)
    throw new Error('Failed to generate thumbnail')
  }
}
