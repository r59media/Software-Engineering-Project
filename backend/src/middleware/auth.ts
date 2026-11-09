import type { Context, Next } from 'hono'
import type { Bindings } from '../index'

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

const PBKDF2_PREFIX = 'pbkdf2_sha256'
const PBKDF2_ITERATIONS = 100_000
const PBKDF2_KEY_BITS = 256
const SALT_BYTES = 16

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
}

function hexToBytes(hex: string): Uint8Array | null {
  if (!hex || hex.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(hex)) return null
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < hex.length; i += 2) {
    out[i / 2] = parseInt(hex.substring(i, i + 2), 16)
  }
  return out
}

async function derivePbkdf2Hex(password: string, salt: Uint8Array, iterations: number): Promise<string> {
  const encoder = new TextEncoder()
  const baseKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  )
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt,
      iterations
    },
    baseKey,
    PBKDF2_KEY_BITS
  )
  return bytesToHex(new Uint8Array(derivedBits))
}

/**
 * Generates a salted PBKDF2-SHA256 password hash:
 * Format: pbkdf2_sha256$100000$<16-byte-random-salt-hex>$<32-byte-hash-hex>
 */
export async function hashPassword(password: string, iterations: number = PBKDF2_ITERATIONS): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES))
  const hashHex = await derivePbkdf2Hex(password, salt, iterations)
  return `${PBKDF2_PREFIX}$${iterations}$${bytesToHex(salt)}$${hashHex}`
}

/**
 * Verifies a candidate password against either:
 * 1. A salted PBKDF2-SHA256 hash (`pbkdf2_sha256$<iterations>$<saltHex>$<hashHex>`), OR
 * 2. A legacy secret (for seamless first-login migration, after which it is upgraded to a salted hash in D1).
 */
export async function verifyPassword(
  candidatePassword: string,
  storedSecretOrHash: string
): Promise<{ matches: boolean; needsHashUpgrade: boolean }> {
  if (!candidatePassword || !storedSecretOrHash) {
    return { matches: false, needsHashUpgrade: false }
  }
  if (storedSecretOrHash.startsWith(`${PBKDF2_PREFIX}$`)) {
    const parts = storedSecretOrHash.split('$')
    if (parts.length !== 4) return { matches: false, needsHashUpgrade: false }
    const iterations = Number(parts[1])
    const salt = hexToBytes(parts[2])
    const expectedHashHex = parts[3].toLowerCase()
    if (!iterations || iterations < 10_000 || iterations > 1_000_000 || !salt) {
      return { matches: false, needsHashUpgrade: false }
    }
    const derivedHex = await derivePbkdf2Hex(candidatePassword, salt, iterations)
    return {
      matches: timingSafeEqual(derivedHex, expectedHashHex),
      needsHashUpgrade: false
    }
  }
  // Legacy raw secret comparison (constant-time) — triggers automatic upgrade to salted PBKDF2 hash in D1
  const matches = timingSafeEqual(candidatePassword, storedSecretOrHash)
  return { matches, needsHashUpgrade: matches }
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
 * Parses a named cookie from the Cookie header.
 */
export function getCookieValue(cookieHeader: string | undefined, name: string): string | null {
  if (!cookieHeader) return null
  const parts = cookieHeader.split(';')
  for (const part of parts) {
    const eqIdx = part.indexOf('=')
    if (eqIdx === -1) continue
    const k = part.substring(0, eqIdx).trim()
    if (k === name) {
      const val = part.substring(eqIdx + 1).trim()
      if (val) {
        try {
          return decodeURIComponent(val)
        } catch {
          return val
        }
      }
    }
  }
  return null
}

/**
 * Extracts the session token from:
 * 1. Authorization: Bearer <token> (for API clients/tests), OR
 * 2. HttpOnly cookie `r59_session` (for browser Admin SPA).
 */
export function extractSessionToken(c: Context): string | null {
  const auth = c.req.header('Authorization')
  if (auth && auth.startsWith('Bearer ')) {
    const token = auth.substring(7).trim()
    if (token && token !== 'cookie') return token
  }
  const cookieToken = getCookieValue(c.req.header('Cookie'), 'r59_session')
  if (cookieToken) return cookieToken
  return null
}

/**
 * Strictly extracts client IP from Cloudflare's non-spoofable CF-Connecting-IP header.
 * Explicitly ignores X-Forwarded-For and X-Real-IP.
 */
export function getTrustedClientIp(c: Context): string {
  return (c.req.header('cf-connecting-ip') || 'unknown').trim()
}

/**
 * PCI / Bank Data Guard: Detects raw credit card numbers (13-19 digit PANs)
 * or forbidden raw card/bank keys in request payloads.
 */
const FORBIDDEN_PAYMENT_KEYS = new Set([
  'cardnumber', 'card_number', 'pan', 'cvv', 'cvc', 'cvv2', 'csc',
  'securitycode', 'security_code', 'pin', 'accountnumber', 'account_number',
  'routingnumber', 'routing_number', 'iban', 'swift', 'bankaccount', 'bank_account'
])

export function hasForbiddenPaymentFields(obj: unknown): boolean {
  if (!obj || typeof obj !== 'object') return false
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const normKey = k.toLowerCase().replace(/[\s_-]/g, '')
    if (FORBIDDEN_PAYMENT_KEYS.has(k.toLowerCase()) || FORBIDDEN_PAYMENT_KEYS.has(normKey)) {
      return true
    }
    if (typeof v === 'string') {
      const digitsOnly = v.replace(/[\s-]/g, '')
      if (/^\d{13,19}$/.test(digitsOnly)) {
        return true
      }
    } else if (typeof v === 'object' && v !== null) {
      if (hasForbiddenPaymentFields(v)) return true
    }
  }
  return false
}

let lastDbCheckMs = 0
const DB_CACHE_TTL_MS = 30_000

/**
 * Revokes a session token in D1 database and in-memory cache across Cloudflare Worker isolates.
 */
export async function revokeTokenInDb(db: D1Database | undefined, token: string): Promise<void> {
  if (!token) return
  revokeSessionToken(token)
  lastDbCheckMs = 0
  if (!db) return

  try {
    const parts = token.split('.')
    const sig = parts.length > 1 ? parts[1] : token
    const now = Date.now()
    const expiry = now + SESSION_TTL_MS

    let revokedMap: Record<string, number> = {}

    // Read existing revoked tokens using setting_key / setting_value
    try {
      const row = await db.prepare("SELECT setting_value FROM Admin_Settings WHERE setting_key = 'revoked_tokens'").first<{ setting_value: string }>()
      if (row && typeof row.setting_value === 'string') {
        const parsed = JSON.parse(row.setting_value)
        if (parsed && typeof parsed === 'object') {
          revokedMap = parsed
        }
      }
    } catch {}

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

    await db.prepare(
      "INSERT INTO Admin_Settings (setting_key, setting_value) VALUES ('revoked_tokens', ?) ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value"
    ).bind(jsonStr).run()
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

  const parts = token.split('.')
  const sig = parts.length > 1 ? parts[1] : token
  if (isTokenRevoked(sig)) return true

  const now = Date.now()
  if (now - lastDbCheckMs < DB_CACHE_TTL_MS) {
    return false
  }

  if (!db) return false

  try {
    const row = await db.prepare("SELECT setting_value FROM Admin_Settings WHERE setting_key = 'revoked_tokens'").first<{ setting_value: string }>()
    lastDbCheckMs = now

    if (row && typeof row.setting_value === 'string') {
      const parsed = JSON.parse(row.setting_value) as Record<string, number>
      if (parsed && typeof parsed === 'object') {
        for (const [key, exp] of Object.entries(parsed)) {
          if (typeof exp === 'number' && exp > now) {
            revokedTokens.set(key, exp)
          }
        }
        if (isTokenRevoked(token) || isTokenRevoked(sig)) {
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
    const method = c.req.method.toUpperCase()
    const hasBearer = Boolean(c.req.header('Authorization')?.startsWith('Bearer '))
    if (!hasBearer && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      const xrw = c.req.header('X-Requested-With')
      const secFetchSite = c.req.header('Sec-Fetch-Site')
      const origin = c.req.header('Origin')
      const reqOrigin = new URL(c.req.url).origin
      const csrfSafe =
        xrw === 'XMLHttpRequest' ||
        secFetchSite === 'same-origin' ||
        (origin && origin === reqOrigin)
      if (!csrfSafe) {
        return c.json({
          error: {
            code: 'FORBIDDEN',
            message: 'CSRF validation failed for cookie-authenticated request.',
            details: []
          }
        }, 403)
      }
    }
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

export const authMiddleware = adminAuth
