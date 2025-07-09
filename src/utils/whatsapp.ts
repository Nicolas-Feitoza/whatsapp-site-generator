export const sendTextMessage = async (to: string, text: string) => {
  try {
    const response = await fetch(
      `https://graph.facebook.com/v17.0/${process.env.WHATSAPP_PHONE_ID}/messages`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.WHATSAPP_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to,
          type: 'text',
          text: { body: text }
        })
      }
    )

    const data = await response.json()
    if (!response.ok) throw data
    return data
  } catch (error) {
    console.error('WhatsApp send error:', error)
    throw error
  }
}

export const sendImageMessage = async (to: string, imageUrl: string) => {
  try {
    const response = await fetch(
      `https://graph.facebook.com/v17.0/${process.env.WHATSAPP_PHONE_ID}/messages`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.WHATSAPP_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to,
          type: 'image',
          image: {
            link: imageUrl,
            caption: 'Preview do seu site gerado'
          }
        })
      }
    )

    const data = await response.json()
    if (!response.ok) throw data
    return data
  } catch (error) {
    console.error('WhatsApp image send error:', error)
    throw error
  }
}