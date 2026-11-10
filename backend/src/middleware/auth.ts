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
 * Retrieves the session signing secret from the environment.
 * Requires at least 32 characters and never falls back to password or ADMIN_SECRET.
 */
export function getSigningSecret(env?: Bindings): string | null {
  return env?.SESSION_SECRET && env.SESSION_SECRET.length >= 32 ? env.SESSION_SECRET : null
}

/**
 * Creates an HMAC-SHA256 signed session token containing the authenticated email, issuedAt timestamp, and expiration.
 */
export async function createSessionToken(secret: string, email: string): Promise<string> {
  const now = Date.now()
  const expiry = now + SESSION_TTL_MS
  const payload = `${email}:${now}:${expiry}`
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
export async function verifySessionToken(
  token: string,
  secret: string
): Promise<{ valid: boolean; email?: string; issuedAt?: number }> {
  try {
    const parts = token.split('.')
    if (parts.length !== 2) return { valid: false }
    const [payloadB64, providedSigHex] = parts
    const payload = atob(payloadB64)
    const colonLast = payload.lastIndexOf(':')
    if (colonLast === -1) return { valid: false }
    const expiryStr = payload.substring(colonLast + 1)
    const rem = payload.substring(0, colonLast)
    const colonSecondLast = rem.lastIndexOf(':')
    if (colonSecondLast === -1) return { valid: false }
    const issuedAtStr = rem.substring(colonSecondLast + 1)
    const email = rem.substring(0, colonSecondLast)

    const issuedAt = Number(issuedAtStr)
    const expiry = Number(expiryStr)

    if (!email || !issuedAt || !expiry || isNaN(issuedAt) || isNaN(expiry) || Date.now() > expiry) {
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
    return { valid: true, email, issuedAt }
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
 * 1. Authorization: Bearer <token> (source: 'header'), OR
 * 2. Cookie __Host-r59_session, fallback to r59_session (source: 'cookie').
 */
export function extractSessionToken(c: Context): { token: string | null; source: 'header' | 'cookie' | null } {
  const auth = c.req.header('Authorization')
  if (auth && auth.startsWith('Bearer ')) {
    const token = auth.substring(7).trim()
    if (token && token !== 'cookie') {
      return { token, source: 'header' }
    }
  }
  const cookieHeader = c.req.header('Cookie')
  const hostCookie = getCookieValue(cookieHeader, '__Host-r59_session')
  if (hostCookie) {
    return { token: hostCookie, source: 'cookie' }
  }
  const legacyCookie = getCookieValue(cookieHeader, 'r59_session')
  if (legacyCookie) {
    return { token: legacyCookie, source: 'cookie' }
  }
  return { token: null, source: null }
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

// ── Atomic D1 Distributed Rate Limiter for Admin Authentication (Finding 2) ──
export function normalizeIpBucket(ip: string): string {
  const cleanIp = (ip || 'unknown').trim()
  if (cleanIp.includes(':')) {
    // Group IPv6 addresses by /64 prefix to prevent prefix cycling
    const parts = cleanIp.split(':')
    return `ip:${parts.slice(0, 4).join(':')}::/64`
  }
  return `ip:${cleanIp}`
}

export async function checkAndRecordLoginAttempt(
  db: D1Database | undefined,
  ip: string
): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
  const now = Date.now()
  const ipBucket = normalizeIpBucket(ip)
  const accountBucket = 'account'

  const IP_WINDOW_MS = 60 * 1000
  const MAX_IP_ATTEMPTS = 5

  const ACCOUNT_WINDOW_MS = 15 * 60 * 1000
  const MAX_ACCOUNT_ATTEMPTS = 20

  if (!db) {
    return { allowed: true, retryAfterSeconds: 0 }
  }

  try {
    // 1. IP bucket atomic increment BEFORE password evaluation (Finding 2)
    const ipRow = await db.prepare(
      `INSERT INTO Login_Attempts (bucket, attempts, window_start) VALUES (?1, 1, ?2)
       ON CONFLICT(bucket) DO UPDATE SET
         attempts = CASE WHEN ?2 - window_start > ?3 THEN 1 ELSE attempts + 1 END,
         window_start = CASE WHEN ?2 - window_start > ?3 THEN ?2 ELSE window_start END
       RETURNING attempts, window_start`
    ).bind(ipBucket, now, IP_WINDOW_MS).first<{ attempts: number; window_start: number }>()

    if (ipRow && ipRow.attempts > MAX_IP_ATTEMPTS) {
      const remainingMs = Math.max(1000, IP_WINDOW_MS - (now - ipRow.window_start))
      return { allowed: false, retryAfterSeconds: Math.ceil(remainingMs / 1000) }
    }

    // 2. Account-wide bucket atomic increment (Finding 2)
    const accRow = await db.prepare(
      `INSERT INTO Login_Attempts (bucket, attempts, window_start) VALUES (?1, 1, ?2)
       ON CONFLICT(bucket) DO UPDATE SET
         attempts = CASE WHEN ?2 - window_start > ?3 THEN 1 ELSE attempts + 1 END,
         window_start = CASE WHEN ?2 - window_start > ?3 THEN ?2 ELSE window_start END
       RETURNING attempts, window_start`
    ).bind(accountBucket, now, ACCOUNT_WINDOW_MS).first<{ attempts: number; window_start: number }>()

    if (accRow && accRow.attempts > MAX_ACCOUNT_ATTEMPTS) {
      const remainingMs = Math.max(1000, ACCOUNT_WINDOW_MS - (now - accRow.window_start))
      return { allowed: false, retryAfterSeconds: Math.ceil(remainingMs / 1000) }
    }

    return { allowed: true, retryAfterSeconds: 0 }
  } catch (err) {
    console.warn('[rate-limit] D1 rate limiter error:', err)
    return { allowed: true, retryAfterSeconds: 0 }
  }
}

export async function clearLoginAttempts(db: D1Database | undefined, ip: string): Promise<void> {
  if (!db) return
  const ipBucket = normalizeIpBucket(ip)
  try {
    await db.prepare('DELETE FROM Login_Attempts WHERE bucket IN (?, ?)').bind(ipBucket, 'account').run()
  } catch {}
}

let lastDbCheckMs = 0
const DB_CACHE_TTL_MS = 30_000

/**
 * Revokes a session token in D1 database (Revoked_Sessions table) and in-memory cache across Cloudflare Worker isolates.
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

    // Insert into dedicated Revoked_Sessions table (Finding 3)
    await db.prepare(
      'INSERT OR IGNORE INTO Revoked_Sessions (signature, expires_at) VALUES (?, ?)'
    ).bind(sig, expiry).run().catch(async () => {
      // Fallback if table not yet initialized
      await db.prepare(
        'CREATE TABLE IF NOT EXISTS Revoked_Sessions (signature TEXT PRIMARY KEY, expires_at INTEGER NOT NULL)'
      ).run().catch(() => {})
      await db.prepare(
        'INSERT OR IGNORE INTO Revoked_Sessions (signature, expires_at) VALUES (?, ?)'
      ).bind(sig, expiry).run()
    })

    // Periodically prune expired revoked sessions (1 in 10 chance)
    if (Math.random() < 0.1) {
      await db.prepare('DELETE FROM Revoked_Sessions WHERE expires_at < ?').bind(now).run().catch(() => {})
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

  const parts = token.split('.')
  const sig = parts.length > 1 ? parts[1] : token
  if (isTokenRevoked(sig)) return true

  const now = Date.now()
  if (now - lastDbCheckMs < DB_CACHE_TTL_MS) {
    return false
  }

  if (!db) return false

  try {
    const row = await db.prepare(
      'SELECT 1 FROM Revoked_Sessions WHERE signature = ? AND expires_at > ? LIMIT 1'
    ).bind(sig, now).first()
    lastDbCheckMs = now

    if (row) {
      revokedTokens.set(sig, now + SESSION_TTL_MS)
      return true
    }
  } catch (err) {
    // Graceful fallback if table query fails
  }

  return false
}

/**
 * Middleware that strictly checks for a valid HMAC-signed session token.
 * Fails closed if session signing secret is not configured or < 32 characters.
 */
export const adminAuth = async (c: Context<{ Bindings: Bindings }>, next: Next) => {
  const signingSecret = getSigningSecret(c.env)
  if (!signingSecret) {
    return c.json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Server authentication is not configured.',
        details: []
      }
    }, 500)
  }

  const { token, source } = extractSessionToken(c)
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
  if (!session.valid) {
    return c.json({
      error: {
        code: 'UNAUTHORIZED',
        message: 'Invalid or expired session token.',
        details: []
      }
    }, 401)
  }

  const adminEmail = c.env.ADMIN_EMAIL ? c.env.ADMIN_EMAIL.trim().toLowerCase() : ''
  const sessionEmail = session.email ? session.email.trim().toLowerCase() : ''
  if (!adminEmail || !sessionEmail || !timingSafeEqual(sessionEmail, adminEmail)) {
    return c.json({
      error: {
        code: 'UNAUTHORIZED',
        message: 'Invalid or expired session token.',
        details: []
      }
    }, 401)
  }

  if (c.env.DB) {
    try {
      const row = await c.env.DB.prepare(
        "SELECT setting_value FROM Admin_Settings WHERE setting_key = 'sessions_valid_after'"
      ).first<{ setting_value: string }>()
      if (row?.setting_value) {
        const validAfter = Number(row.setting_value)
        if (!isNaN(validAfter) && session.issuedAt !== undefined && session.issuedAt < validAfter) {
          return c.json({
            error: {
              code: 'UNAUTHORIZED',
              message: 'Session has been revoked due to password change or logout everywhere.',
              details: []
            }
          }, 401)
        }
      }
    } catch (err) {
      console.warn('[auth] DB sessions_valid_after check warning:', err)
    }
  }

  const method = c.req.method.toUpperCase()
  if (source === 'cookie' && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
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

export const authMiddleware = adminAuth
