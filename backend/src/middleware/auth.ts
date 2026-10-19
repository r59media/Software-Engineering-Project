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
 * Extracts the session token strictly from Authorization: Bearer <token>.
 * Does NOT fall back to the r59_session cookie, ensuring an old browser cookie
 * cannot authenticate requests without an explicit in-memory Bearer token.
 */
export function extractSessionToken(c: Context): string | null {
  const auth = c.req.header('Authorization')
  if (auth && auth.startsWith('Bearer ')) {
    const token = auth.substring(7).trim()
    if (token) return token
  }
  return null
}

/**
 * Revokes a session token in D1 database and in-memory cache across Cloudflare Worker isolates.
 */
export async function revokeTokenInDb(db: D1Database | undefined, token: string): Promise<void> {
  if (!token) return
  revokeSessionToken(token)
  if (!db) return

  try {
    const parts = token.split('.')
    const sig = parts.length > 1 ? parts[1] : token
    const now = Date.now()
    const expiry = now + SESSION_TTL_MS

    let revokedMap: Record<string, number> = {}

    // Read existing revoked tokens (supporting key/value and setting_key/setting_value)
    let rawValue: string | null = null
    try {
      const row = await db.prepare("SELECT value FROM Admin_Settings WHERE key = 'revoked_tokens'").first<{ value: string }>()
      if (row && typeof row.value === 'string') {
        rawValue = row.value
      }
    } catch {
      try {
        const row = await db.prepare("SELECT setting_value FROM Admin_Settings WHERE setting_key = 'revoked_tokens'").first<{ setting_value: string }>()
        if (row && typeof row.setting_value === 'string') {
          rawValue = row.setting_value
        }
      } catch {}
    }

    if (!rawValue) {
      try {
        const row = await db.prepare("SELECT setting_value FROM Admin_Settings WHERE setting_key = 'revoked_tokens'").first<{ setting_value: string }>()
        if (row && typeof row.setting_value === 'string') {
          rawValue = row.setting_value
        }
      } catch {}
    }

    if (rawValue) {
      try {
        const parsed = JSON.parse(rawValue)
        if (parsed && typeof parsed === 'object') {
          revokedMap = parsed
        }
      } catch {}
    }

    // Prune entries where expiry <= Date.now()
    const cleanedMap: Record<string, number> = {}
    for (const [s, exp] of Object.entries(revokedMap)) {
      if (typeof exp === 'number' && exp > now) {
        cleanedMap[s] = exp
      }
    }

    // Add current token's signature with Date.now() + 24 * 60 * 60 * 1000
    cleanedMap[sig] = expiry

    // Cap at 200 entries
    const entries = Object.entries(cleanedMap)
    if (entries.length > 200) {
      entries.sort((a, b) => a[1] - b[1]) // oldest first
      const excess = entries.length - 200
      for (let i = 0; i < excess; i++) {
        delete cleanedMap[entries[i][0]]
      }
    }

    const jsonStr = JSON.stringify(cleanedMap)

    let saved = false
    try {
      await db.prepare(
        "INSERT INTO Admin_Settings (setting_key, setting_value) VALUES ('revoked_tokens', ?) ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value"
      ).bind(jsonStr).run()
      saved = true
    } catch {}

    if (!saved) {
      try {
        await db.prepare(
          "INSERT OR REPLACE INTO Admin_Settings (key, value) VALUES ('revoked_tokens', ?)"
        ).bind(jsonStr).run()
      } catch {}
    }
  } catch (err) {
    // DB errors should never crash logout
    console.warn('[auth] DB token revocation warning:', err)
  }
}

/**
 * Checks whether a token is revoked, consulting both the in-memory cache and D1 database.
 */
export async function isTokenRevokedInDb(db: D1Database | undefined, token: string): Promise<boolean> {
  if (!token) return true
  if (isTokenRevoked(token)) return true
  if (!db) return false

  try {
    const parts = token.split('.')
    const sig = parts.length > 1 ? parts[1] : token
    const now = Date.now()

    let rawValue: string | null = null
    try {
      const row = await db.prepare("SELECT value FROM Admin_Settings WHERE key = 'revoked_tokens'").first<{ value: string }>()
      if (row && typeof row.value === 'string') {
        rawValue = row.value
      }
    } catch {
      try {
        const row = await db.prepare("SELECT setting_value FROM Admin_Settings WHERE setting_key = 'revoked_tokens'").first<{ setting_value: string }>()
        if (row && typeof row.setting_value === 'string') {
          rawValue = row.setting_value
        }
      } catch {}
    }

    if (!rawValue) {
      try {
        const row = await db.prepare("SELECT setting_value FROM Admin_Settings WHERE setting_key = 'revoked_tokens'").first<{ setting_value: string }>()
        if (row && typeof row.setting_value === 'string') {
          rawValue = row.setting_value
        }
      } catch {}
    }

    if (rawValue) {
      const parsed = JSON.parse(rawValue) as Record<string, number>
      if (parsed && typeof parsed === 'object') {
        const exp = parsed[sig]
        if (typeof exp === 'number' && exp > now) {
          revokeSessionToken(token)
          return true
        }
      }
    }
  } catch (err) {
    console.warn('[auth] DB token check warning:', err)
  }

  return false
}

/**
 * Middleware that strictly checks for a valid HMAC-signed session token
 * via Authorization Bearer header.
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

  if (await isTokenRevokedInDb(c.env.DB, token)) {
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
