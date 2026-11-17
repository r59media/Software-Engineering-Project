/**
 * Signed Media URL utility for HMAC-SHA256 short-lived token generation and verification.
 */

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

/**
 * Constant-time string comparison to prevent timing attacks without length leaks.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false
  const encoder = new TextEncoder()
  const aBytes = encoder.encode(a)
  const bBytes = encoder.encode(b)

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
 * Generates an HMAC-SHA256 signature and expiration timestamp for a media file key.
 */
export async function signMediaKey(
  fileKey: string,
  secret: string,
  ttlSeconds: number = 30
): Promise<{ exp: number; sig: string }> {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const data = encoder.encode(`${fileKey}:${exp}`)
  const signatureBytes = await crypto.subtle.sign('HMAC', key, data)
  const sig = toBase64Url(new Uint8Array(signatureBytes))
  return { exp, sig }
}

/**
 * Verifies an HMAC-SHA256 signature for a media file key and expiration timestamp.
 */
export async function verifyMediaSignature(
  fileKey: string,
  exp: number,
  sig: string,
  secret: string
): Promise<boolean> {
  try {
    if (!fileKey || !sig || !secret || typeof exp !== 'number' || isNaN(exp)) {
      return false
    }

    const now = Math.floor(Date.now() / 1000)
    if (now > exp) {
      return false
    }

    const encoder = new TextEncoder()
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    )
    const data = encoder.encode(`${fileKey}:${exp}`)
    const signatureBytes = await crypto.subtle.sign('HMAC', key, data)
    const expectedSig = toBase64Url(new Uint8Array(signatureBytes))

    return timingSafeEqual(sig, expectedSig)
  } catch {
    return false
  }
}

export interface ByteRange {
  start: number
  end: number
}

/**
 * Parses HTTP Range header according to RFC 7233 / 9110.
 * Returns range offsets, null if header is missing/invalid, or 'unsatisfiable'.
 */
export function parseRangeHeader(
  rangeHeader: string | undefined | null,
  totalLength: number
): ByteRange | null | 'unsatisfiable' {
  if (!rangeHeader || typeof rangeHeader !== 'string' || totalLength <= 0) {
    return null
  }

  const match = rangeHeader.trim().match(/^bytes=(\d*)-(\d*)$/)
  if (!match) return null

  const [, startStr, endStr] = match
  if (!startStr && !endStr) return null

  let start: number
  let end: number

  if (!startStr) {
    // Suffix range: bytes=-500 (last 500 bytes)
    const suffix = parseInt(endStr, 10)
    if (isNaN(suffix) || suffix <= 0) return null
    start = Math.max(0, totalLength - suffix)
    end = totalLength - 1
  } else if (!endStr) {
    // Prefix range: bytes=500- (from 500 to end)
    start = parseInt(startStr, 10)
    if (isNaN(start) || start < 0) return null
    end = totalLength - 1
  } else {
    start = parseInt(startStr, 10)
    end = parseInt(endStr, 10)
    if (isNaN(start) || isNaN(end) || start < 0) return null
  }

  if (start >= totalLength || start > end) {
    return 'unsatisfiable'
  }

  end = Math.min(end, totalLength - 1)
  return { start, end }
}

const RESCHEDULE_TOKEN_PREFIX = 'r59-booking-reschedule-v1'
const CALENDAR_FEED_TOKEN_PREFIX = 'r59-calendar-feed-v1'

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

async function hmacSha256Hex(message: string, secret: string): Promise<string> {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(message))
  return bytesToHex(new Uint8Array(signature))
}

export async function signRescheduleToken(
  bookingId: number | string,
  clientEmail: string,
  secret: string
): Promise<string> {
  const payload = `${RESCHEDULE_TOKEN_PREFIX}:${String(bookingId).trim()}:${clientEmail.trim().toLowerCase()}`
  return hmacSha256Hex(payload, secret)
}

export async function verifyRescheduleToken(
  bookingId: number | string,
  clientEmail: string,
  token: string,
  secret: string
): Promise<boolean> {
  if (!token || !secret || !clientEmail) return false
  const expected = await signRescheduleToken(bookingId, clientEmail, secret)
  return timingSafeEqual(expected, token.trim())
}

export async function signCalendarFeedToken(secret: string): Promise<string> {
  return hmacSha256Hex(CALENDAR_FEED_TOKEN_PREFIX, secret)
}

export async function verifyCalendarFeedToken(token: string, secret: string): Promise<boolean> {
  if (!token || !secret) return false
  const expected = await signCalendarFeedToken(secret)
  return timingSafeEqual(expected, token.trim())
}
