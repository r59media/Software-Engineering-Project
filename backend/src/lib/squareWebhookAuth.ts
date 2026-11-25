import { timingSafeEqual } from '../utils/crypto.ts'

/**
 * Verifies Square's `x-square-hmacsha256-signature` header:
 * base64(HMAC-SHA256(key, notificationUrl + rawBody)), compared in constant time.
 * Returns false on any empty input or error.
 */
export async function verifySquareSignature(input: {
  body: string
  signature: string
  key: string
  url: string
}): Promise<boolean> {
  try {
    const { body, signature, key, url } = input || ({} as typeof input)
    for (const v of [body, signature, key, url]) {
      if (typeof v !== 'string' || v === '') return false
    }
    const encoder = new TextEncoder()
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      encoder.encode(key),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    )
    const sig = new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(url + body)))
    let binary = ''
    for (let i = 0; i < sig.length; i++) binary += String.fromCharCode(sig[i])
    return timingSafeEqual(btoa(binary), signature)
  } catch {
    return false
  }
}
