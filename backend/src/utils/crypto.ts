/**
 * Shared cryptographic utilities for constant-time comparison and HMAC-SHA256 signing.
 */

const textEncoder = new TextEncoder()

/**
 * Constant-time string comparison to prevent timing attacks without length leaks.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false
  const aBytes = textEncoder.encode(a)
  const bBytes = textEncoder.encode(b)

  // Compare all bytes without early return on length mismatch to prevent length-leak timing branches
  let mismatch = aBytes.byteLength === bBytes.byteLength ? 0 : 1
  const maxLen = Math.max(aBytes.byteLength, bBytes.byteLength)
  for (let i = 0; i < maxLen; i++) {
    const aByte = i < aBytes.byteLength ? aBytes[i] : 0
    const bByte = i < bBytes.byteLength ? bBytes[i] : 0
    mismatch |= aByte ^ bByte
  }
  return mismatch === 0
}

/**
 * Encodes a byte array as lowercase hexadecimal.
 */
export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Computes an HMAC-SHA256 digest over a UTF-8 message and returns lowercase hex.
 */
export async function hmacSha256Hex(message: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    textEncoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const signature = await crypto.subtle.sign('HMAC', key, textEncoder.encode(message))
  return bytesToHex(new Uint8Array(signature))
}
