import { Context, Next } from 'hono'
import { Bindings } from '../index'

/**
 * Constant-time string comparison to prevent timing attacks without length leaks.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false
  const encoder = new TextEncoder()
  const aBytes = encoder.encode(a)
  const bBytes = encoder.encode(b)

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

const SESSION_TTL_MS = 24 * 60 * 60 * 1000 // 24 hours

/**
 * Creates an HMAC-SHA256 signed session token containing the authenticated email and expiration.
 */
export async function createSessionToken(secret: string, email: string): Promise<string> {
  const expiry = Date.now() + SESSION_TTL_MS
  const payload = `${email}:${expiry}`
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const signatureBytes = await crypto.subtle.sign('HMAC', key, encoder.encode(payload))
  const signatureHex = Array.from(new Uint8Array(signatureBytes))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
  const payloadB64 = btoa(payload)
  return `${payloadB64}.${signatureHex}`
}

/**
 * Verifies an HMAC-SHA256 signed session token.
 */
export async function verifySessionToken(token: string, secret: string): Promise<{ valid: boolean; email?: string }> {
  try {
    const parts = token.split('.')
    if (parts.length !== 2) return { valid: false }
    const [payloadB64, providedSigHex] = parts
    const payload = atob(payloadB64)
    const colonIdx = payload.lastIndexOf(':')
    if (colonIdx === -1) return { valid: false }
    const email = payload.substring(0, colonIdx)
    const expiry = Number(payload.substring(colonIdx + 1))
    if (!email || !expiry || isNaN(expiry) || Date.now() > expiry) {
      return { valid: false }
    }
    const encoder = new TextEncoder()
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    )
    const signatureBytes = await crypto.subtle.sign('HMAC', key, encoder.encode(payload))
    const expectedSigHex = Array.from(new Uint8Array(signatureBytes))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('')
    if (!timingSafeEqual(providedSigHex, expectedSigHex)) {
      return { valid: false }
    }
    return { valid: true, email }
  } catch {
    return { valid: false }
  }
}

const MAX_REVOKED_TOKENS = 1000
const revokedTokens = new Map<string, number>()

function pruneRevokedTokens(now: number): void {
  for (const [tok, exp] of revokedTokens.entries()) {
    if (now > exp) {
      revokedTokens.delete(tok)
    }
  }
}

/**
 * Revokes a session token in memory within the isolate (capped at 1000 entries).
 */
export function revokeSessionToken(token: string, ttlMs: number = SESSION_TTL_MS): void {
  if (!token) return
  const now = Date.now()
  pruneRevokedTokens(now)
  if (revokedTokens.size >= MAX_REVOKED_TOKENS) {
    const oldestKey = revokedTokens.keys().next().value
    if (oldestKey) revokedTokens.delete(oldestKey)
  }
  revokedTokens.set(token, now + ttlMs)
}

/**
 * Checks whether a session token has been revoked.
 */
export function isTokenRevoked(token: string): boolean {
  if (!token) return true
  const exp = revokedTokens.get(token)
  if (exp === undefined) return false
  if (Date.now() > exp) {
    revokedTokens.delete(token)
    return false
  }
  return true
}

/**
 * Extracts the session token from Authorization: Bearer <token> first,
 * falling back to the r59_session cookie.
 */
export function extractSessionToken(c: Context): string | null {
  const auth = c.req.header('Authorization')
  if (auth && auth.startsWith('Bearer ')) {
    const token = auth.substring(7).trim()
    if (token) return token
  }
  const cookieHeader = c.req.header('Cookie')
  if (cookieHeader) {
    const cookies = cookieHeader.split(';')
    for (const cookie of cookies) {
      const [rawName, ...rawValParts] = cookie.trim().split('=')
      if (rawName === 'r59_session') {
        const val = rawValParts.join('=').trim()
        if (val) {
          try {
            return decodeURIComponent(val)
          } catch {
            return val
          }
        }
      }
    }
  }
  return null
}

/**
 * Middleware that strictly checks for a valid HMAC-signed session token
 * via Authorization Bearer header or HttpOnly session cookie.
 * Fails closed if ADMIN_SECRET is not configured.
 * Decouples session signing secret (SESSION_SECRET) from ADMIN_SECRET.
 */
export const adminAuth = async (c: Context<{ Bindings: Bindings }>, next: Next) => {
  const secret = c.env.ADMIN_SECRET
  if (!secret) {
    return c.json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Server authentication is not configured.',
        details: []
      }
    }, 500)
  }

  const signingSecret = c.env.SESSION_SECRET || secret

  const token = extractSessionToken(c)
  if (!token) {
    return c.json({
      error: {
        code: 'UNAUTHORIZED',
        message: 'Authentication required. Provide a valid Authorization header.',
        details: []
      }
    }, 401)
  }

  if (isTokenRevoked(token)) {
    return c.json({
      error: {
        code: 'UNAUTHORIZED',
        message: 'Invalid or expired session token.',
        details: []
      }
    }, 401)
  }

  const session = await verifySessionToken(token, signingSecret)
  if (session.valid) {
    return await next()
  }

  return c.json({
    error: {
      code: 'UNAUTHORIZED',
      message: 'Invalid or expired session token.',
      details: []
    }
  }, 401)
}
