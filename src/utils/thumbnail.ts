import { supabase } from '@/utils/supabase'

export const captureThumbnail = async (siteUrl: string): Promise<string> => {
  try {
    // 1️⃣ Gerar imagem diretamente como dataURI
    const apiUrl = `https://api.microlink.io?url=${encodeURIComponent(siteUrl)}&screenshot=true&meta=false&embed=screenshot.dataUri`
    const response = await fetch(apiUrl)

    const ct = response.headers.get('content-type') || ''
    if (!response.ok || !ct.includes('application/json')) {
      const body = await response.text()
      throw new Error(`Microlink não retornou JSON válido (${ct}): ${body.slice(0,100)}`)
    }

    const json = await response.json() as {
      data?: { screenshot?: { dataUri?: string } }
    }

    const dataUri = json.data?.screenshot?.dataUri
    if (!dataUri || !dataUri.startsWith('data:image')) {
      throw new Error(`Microlink falhou ao gerar dataUri válido: ${JSON.stringify(json).slice(0,200)}`)
    }

    // 2️⃣ Extrair o Base64 e transformar em Buffer
    const [, base64] = dataUri.split(',')
    const buffer = Buffer.from(base64, 'base64')

    // 3️⃣ Upload no Supabase com tipo correto
    const fileName = `thumbnail-${Date.now()}.png`
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('thumbnails')
      .upload(fileName, buffer, {
        contentType: 'image/png',
        upsert: false,
        cacheControl: '3600'
      })
    if (uploadError) throw uploadError

    // 4️⃣ Gerar Signed URL de 1 hora
    const { data: signedData, error: signedError } = await supabase.storage
      .from('thumbnails')
      .createSignedUrl(uploadData.path, 60 * 60)

    if (signedError || !signedData?.signedUrl) {
      throw signedError || new Error('Erro ao criar Signed URL da imagem')
    }

    return signedData.signedUrl

  } catch (error) {
    console.error('Thumbnail capture error:', error)
    throw new Error('Failed to generate thumbnail')
  }
}
