import { Context, Next } from 'hono'
import { Bindings } from '../index'

/**
 * Constant-time string comparison to prevent timing attacks.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder()
  const aBytes = encoder.encode(a)
  const bBytes = encoder.encode(b)
  if (aBytes.byteLength !== bBytes.byteLength) {
    // Compare identical buffer to normalize computation time
    crypto.subtle.timingSafeEqual(aBytes, aBytes)
    return false
  }
  return crypto.subtle.timingSafeEqual(aBytes, bBytes)
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

/**
 * Middleware that strictly checks for a valid Authorization header.
 * Fails closed if ADMIN_SECRET is not configured.
 * Accepts either:
 * 1. A valid HMAC-signed session token.
 * 2. The direct ADMIN_SECRET (via constant-time comparison) for API / CLI usage.
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

  const auth = c.req.header('Authorization')
  if (!auth || !auth.startsWith('Bearer ')) {
    return c.json({
      error: {
        code: 'UNAUTHORIZED',
        message: 'Authentication required. Provide a valid Authorization header.',
        details: []
      }
    }, 401)
  }

  const token = auth.substring(7).trim()
  if (!token) {
    return c.json({
      error: {
        code: 'UNAUTHORIZED',
        message: 'Authentication token cannot be empty.',
        details: []
      }
    }, 401)
  }

  // 1. Direct secret check (constant-time)
  if (timingSafeEqual(token, secret)) {
    return await next()
  }

  // 2. Signed session token check
  const session = await verifySessionToken(token, secret)
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
