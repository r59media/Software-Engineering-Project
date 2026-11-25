import type { Context, Next } from 'hono'
import type { Bindings } from '../index'
import { timingSafeEqual, bytesToHex } from '../utils/crypto.ts'
import { checkInMemoryBucket, upsertD1RateLimitBucket, type MemoryBucketEntry } from './rateLimit.ts'

export { timingSafeEqual }

// ── Google ID Token Verification (Web Crypto RS256 + JWKS cache) ──
export interface GoogleJwksKey {
  kty: string
  alg: string
  use?: string
  kid: string
  n: string
  e: string
  [key: string]: unknown
}

const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs'
const JWKS_FORCE_REFRESH_DEBOUNCE_MS = 5 * 60 * 1000 // Debounce forceRefresh to at most once per 5 min

let cachedJwks: GoogleJwksKey[] | null = null
let jwksCachedAt = 0
let jwksTtlMs = 3600 * 1000
let lastJwksForceRefreshAt = 0

function getWorkerCache(): Cache | null {
  try {
    if (typeof caches !== 'undefined' && 'default' in caches) {
      return (caches as any).default as Cache
    }
  } catch {}
  return null
}

export async function getGoogleJwks(forceRefresh = false): Promise<GoogleJwksKey[]> {
  const now = Date.now()

  // 1. In-memory cache check
  if (!forceRefresh && cachedJwks && now - jwksCachedAt < jwksTtlMs) {
    return cachedJwks
  }

  // 2. Debounce forceRefresh to at most once per 5 min per isolate
  if (forceRefresh && cachedJwks && now - lastJwksForceRefreshAt < JWKS_FORCE_REFRESH_DEBOUNCE_MS) {
    return cachedJwks
  }

  const cache = getWorkerCache()
  const cacheKey = new Request(GOOGLE_JWKS_URL)

  // 3. Cache API check (caches.default) if not forcing refresh
  if (!forceRefresh && cache) {
    try {
      const cachedRes = await cache.match(cacheKey)
      if (cachedRes) {
        const cacheControl = cachedRes.headers.get('cache-control')
        let ttlMs = 3600 * 1000
        if (cacheControl) {
          const match = cacheControl.match(/max-age=(\d+)/i)
          if (match) {
            ttlMs = Math.max(60, parseInt(match[1], 10)) * 1000
          }
        }
        const data = (await cachedRes.json()) as { keys?: GoogleJwksKey[] }
        if (data && Array.isArray(data.keys)) {
          cachedJwks = data.keys
          jwksCachedAt = now
          jwksTtlMs = ttlMs
          return cachedJwks
        }
      }
    } catch (cacheErr) {
      console.warn('[auth] caches.default match error:', cacheErr)
    }
  }

  // 4. Fetch fresh JWKS from Google
  if (forceRefresh) {
    lastJwksForceRefreshAt = now
  }

  const res = await fetch(GOOGLE_JWKS_URL)
  if (!res.ok) {
    if (cachedJwks) return cachedJwks
    throw new Error(`Failed to fetch Google JWKS: ${res.statusText}`)
  }

  let ttlSeconds = 3600
  const cacheControl = res.headers.get('cache-control')
  if (cacheControl) {
    const match = cacheControl.match(/max-age=(\d+)/i)
    if (match) {
      ttlSeconds = Math.max(60, parseInt(match[1], 10))
    }
  }
  jwksTtlMs = ttlSeconds * 1000

  // Honor Cache-Control max-age in caches.default
  if (cache) {
    try {
      await cache.put(cacheKey, res.clone())
    } catch (cacheErr) {
      console.warn('[auth] caches.default put error:', cacheErr)
    }
  }

  const data = (await res.json()) as { keys?: GoogleJwksKey[] }
  if (!data || !Array.isArray(data.keys)) {
    throw new Error('Invalid Google JWKS response: missing keys array')
  }

  cachedJwks = data.keys
  jwksCachedAt = now
  return cachedJwks
}

function base64UrlDecode(str: string): Uint8Array {
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/')
  const pad = base64.length % 4
  if (pad === 2) base64 += '=='
  else if (pad === 3) base64 += '='
  else if (pad === 1) throw new Error('Illegal base64url string')
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

function base64UrlDecodeText(str: string): string {
  return new TextDecoder().decode(base64UrlDecode(str))
}

/**
 * Verifies a Google ID token against Google's public JWKS using Web Crypto (RS256).
 * Enforces single-account authorized email check in constant time.
 */
export async function verifyGoogleIdToken(
  idToken: string,
  clientId?: string,
  authorizedEmail?: string,
  options?: { mockKeys?: GoogleJwksKey[]; expectedNonce?: string }
): Promise<{ success: true; email: string; exp: number } | { success: false; error: string }> {
  try {
    if (!idToken || typeof idToken !== 'string') {
      return { success: false, error: 'Missing or invalid ID token' }
    }

    const parts = idToken.split('.')
    if (parts.length !== 3) {
      return { success: false, error: 'Malformed ID token: expected 3 dot-separated segments' }
    }

    const [headerB64, payloadB64, signatureB64] = parts

    let header: { alg?: string; kid?: string; typ?: string }
    let payload: {
      iss?: string
      aud?: string
      exp?: number
      iat?: number
      nonce?: string
      email?: string
      email_verified?: boolean | string
      [key: string]: unknown
    }

    try {
      header = JSON.parse(base64UrlDecodeText(headerB64))
      payload = JSON.parse(base64UrlDecodeText(payloadB64))
    } catch {
      return { success: false, error: 'Failed to decode token header or payload' }
    }

    if (!header || header.alg !== 'RS256' || !header.kid) {
      return { success: false, error: 'Invalid token header: expected RS256 algorithm with kid' }
    }

    // 1. Fetch & match public key from JWKS
    let keys: GoogleJwksKey[]
    if (options?.mockKeys) {
      keys = options.mockKeys
    } else {
      keys = await getGoogleJwks()
    }

    let jwk = keys.find(k => k.kid === header.kid)
    if (!jwk && !options?.mockKeys) {
      const now = Date.now()
      if (now - lastJwksForceRefreshAt >= JWKS_FORCE_REFRESH_DEBOUNCE_MS) {
        keys = await getGoogleJwks(true)
        jwk = keys.find(k => k.kid === header.kid)
      }
    }

    if (!jwk) {
      return { success: false, error: `No matching public key found for kid "${header.kid}"` }
    }

    // 2. Import RSA public key and verify signature with Web Crypto
    const cryptoKey = await crypto.subtle.importKey(
      'jwk',
      {
        kty: jwk.kty,
        n: jwk.n,
        e: jwk.e,
        alg: 'RS256',
        ext: true
      },
      {
        name: 'RSASSA-PKCS1-v1_5',
        hash: 'SHA-256'
      },
      false,
      ['verify']
    )

    const signedData = new TextEncoder().encode(`${headerB64}.${payloadB64}`)
    const signatureBytes = base64UrlDecode(signatureB64)
    const isSignatureValid = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      cryptoKey,
      signatureBytes,
      signedData
    )

    if (!isSignatureValid) {
      return { success: false, error: 'Invalid ID token signature' }
    }

    // 3. Verify claims
    if (!clientId || typeof clientId !== 'string' || !clientId.trim()) {
      return { success: false, error: 'GOOGLE_CLIENT_ID is required and must not be empty' }
    }

    const validIssuers = ['accounts.google.com', 'https://accounts.google.com']
    if (!payload.iss || !validIssuers.includes(payload.iss)) {
      return { success: false, error: `Invalid issuer: ${payload.iss}` }
    }

    if (payload.aud !== clientId) {
      return { success: false, error: `Audience mismatch: expected ${clientId}, got ${payload.aud}` }
    }

    const nowSeconds = Math.floor(Date.now() / 1000)
    const CLOCK_SKEW_SECONDS = 60
    if (!payload.exp || typeof payload.exp !== 'number' || payload.exp < nowSeconds - CLOCK_SKEW_SECONDS) {
      return { success: false, error: 'ID token has expired' }
    }
    if (payload.iat !== undefined && (typeof payload.iat !== 'number' || payload.iat > nowSeconds + CLOCK_SKEW_SECONDS)) {
      return { success: false, error: 'ID token issued in the future' }
    }

    const isEmailVerified = payload.email_verified === true || payload.email_verified === 'true'
    if (!isEmailVerified) {
      return { success: false, error: 'Google account email is not verified' }
    }

    if (!payload.email || typeof payload.email !== 'string') {
      return { success: false, error: 'ID token missing email claim' }
    }

    // 4. If nonce provided, require payload.nonce === nonce in constant time
    if (options?.expectedNonce) {
      const tokenNonce = typeof payload.nonce === 'string' ? payload.nonce : ''
      if (!tokenNonce || !timingSafeEqual(tokenNonce, options.expectedNonce)) {
        return { success: false, error: 'Nonce mismatch' }
      }
    }

    // 5. Enforce single-account check using timingSafeEqual (fail closed if authorizedEmail is empty)
    const targetEmail = (authorizedEmail || '').trim().toLowerCase()
    if (!targetEmail) {
      console.error('[auth] Server misconfigured: authorizedEmail is unset or empty')
      return { success: false, error: 'Server misconfigured' }
    }
    const tokenEmail = payload.email.trim().toLowerCase()
    if (!timingSafeEqual(tokenEmail, targetEmail)) {
      return { success: false, error: `Unauthorized email address: ${payload.email}` }
    }

    return { success: true, email: payload.email, exp: payload.exp }
  } catch (err: any) {
    return { success: false, error: err?.message || 'Token verification failed' }
  }
}

/**
 * @deprecated Legacy PBKDF2 prefix. Replaced by Google Sign-In.
 */
const PBKDF2_PREFIX = 'pbkdf2_sha256'
/**
 * @deprecated Legacy PBKDF2 iterations. Replaced by Google Sign-In.
 */
const PBKDF2_ITERATIONS = 100_000
/**
 * @deprecated Legacy PBKDF2 key bits. Replaced by Google Sign-In.
 */
const PBKDF2_KEY_BITS = 256
/**
 * @deprecated Legacy salt bytes. Replaced by Google Sign-In.
 */
const SALT_BYTES = 16

function hexToBytes(hex: string): Uint8Array | null {
  if (!hex || hex.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(hex)) return null
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < hex.length; i += 2) {
    out[i / 2] = parseInt(hex.substring(i, i + 2), 16)
  }
  return out
}

/**
 * @deprecated Legacy PBKDF2 derivation. Replaced by Google Sign-In.
 */
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
 * @deprecated Legacy PBKDF2 password hashing. Replaced by Google Sign-In.
 */
export async function hashPassword(password: string, iterations: number = PBKDF2_ITERATIONS): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES))
  const hashHex = await derivePbkdf2Hex(password, salt, iterations)
  return `${PBKDF2_PREFIX}$${iterations}$${bytesToHex(salt)}$${hashHex}`
}

/**
 * @deprecated Legacy PBKDF2 password verification. Replaced by Google Sign-In.
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
  // Legacy raw secret comparison (constant-time)
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
 * Retrieves or derives a domain-separated secret for HMAC media URL signing.
 * Uses MEDIA_SIGNING_SECRET when >= 32 chars; otherwise derives via HMAC-SHA256
 * from SESSION_SECRET with context "r59-media-url-signing-v1".
 */
export async function getMediaSigningSecret(env?: Bindings): Promise<string | null> {
  if (typeof env?.MEDIA_SIGNING_SECRET === 'string' && env.MEDIA_SIGNING_SECRET.length >= 32) {
    return env.MEDIA_SIGNING_SECRET
  }
  const sessionSecret = getSigningSecret(env)
  if (!sessionSecret) {
    return null
  }
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(sessionSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const derivedBytes = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode('r59-media-url-signing-v1')
  )
  return bytesToHex(new Uint8Array(derivedBytes))
}

/**
 * Creates an HMAC-SHA256 signed session token containing the authenticated email, issuedAt timestamp, expiration, and jti.
 * Fixed positional args: (secret: string, email: string).
 */
export async function createSessionToken(secret: string, email: string): Promise<string> {
  const now = Date.now()
  const expiry = now + SESSION_TTL_MS
  const jti = crypto.randomUUID()
  const payload = `${email}:${now}:${expiry}:${jti}`
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const signatureBytes = await crypto.subtle.sign('HMAC', key, encoder.encode(payload))
  const signatureHex = bytesToHex(new Uint8Array(signatureBytes))
  const payloadB64 = btoa(payload)
  return `${payloadB64}.${signatureHex}`
}

/**
 * Verifies an HMAC-SHA256 signed session token (supports both 4-part email:issuedAt:expiry:jti and legacy 3-part format).
 */
export async function verifySessionToken(
  token: string,
  secret: string
): Promise<{ valid: boolean; email?: string; issuedAt?: number; jti?: string }> {
  try {
    const parts = token.split('.')
    if (parts.length !== 2) return { valid: false }
    const [payloadB64, providedSigHex] = parts
    const payload = atob(payloadB64)
    const segments = payload.split(':')
    if (segments.length < 3) return { valid: false }

    const lastSegment = segments[segments.length - 1]
    const isThreePartNumericExpiry = /^\d+$/.test(lastSegment)

    let email: string
    let issuedAtStr: string
    let expiryStr: string
    let jti: string | undefined

    if (isThreePartNumericExpiry) {
      expiryStr = lastSegment
      issuedAtStr = segments[segments.length - 2]
      email = segments.slice(0, -2).join(':')
    } else {
      if (segments.length < 4 || !lastSegment) return { valid: false }
      jti = lastSegment
      expiryStr = segments[segments.length - 2]
      issuedAtStr = segments[segments.length - 3]
      email = segments.slice(0, -3).join(':')
    }

    if (!/^\d+$/.test(issuedAtStr) || !/^\d+$/.test(expiryStr)) {
      return { valid: false }
    }
    const issuedAt = Number(issuedAtStr)
    const expiry = Number(expiryStr)

    if (!email || !issuedAt || !expiry || !Number.isFinite(issuedAt) || !Number.isFinite(expiry) || Date.now() > expiry) {
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
    const expectedSigHex = bytesToHex(new Uint8Array(signatureBytes))
    if (!timingSafeEqual(providedSigHex, expectedSigHex)) {
      return { valid: false }
    }
    return { valid: true, email, issuedAt, ...(jti ? { jti } : {}) }
  } catch {
    return { valid: false }
  }
}

const MAX_REVOKED_TOKENS = 1000
const revokedTokens = new Map<string, number>()

function pruneRevokedTokens(now: number): void {
  for (const [k, exp] of revokedTokens.entries()) {
    if (now > exp) revokedTokens.delete(k)
  }
}

function getTokenKey(token: string): string {
  const parts = token.split('.')
  return parts.length > 1 ? parts[1] : token
}

/**
 * Revokes a session token in memory within the isolate (capped at 1000 entries).
 */
export function revokeSessionToken(token: string, ttlMs: number = SESSION_TTL_MS): void {
  if (!token) return
  const now = Date.now()
  pruneRevokedTokens(now)
  const key = getTokenKey(token)
  if (revokedTokens.size >= MAX_REVOKED_TOKENS) {
    const oldestKey = revokedTokens.keys().next().value
    if (oldestKey) revokedTokens.delete(oldestKey)
  }
  const expiry = now + ttlMs
  revokedTokens.set(token, expiry)
  revokedTokens.set(key, expiry)
}

/**
 * Checks whether a session token has been revoked in memory.
 */
export function isTokenRevoked(token: string): boolean {
  if (!token) return true
  const now = Date.now()
  const exp = revokedTokens.get(token)
  if (exp !== undefined) {
    if (now > exp) {
      revokedTokens.delete(token)
    } else {
      return true
    }
  }
  const key = getTokenKey(token)
  const keyExp = revokedTokens.get(key)
  if (keyExp !== undefined) {
    if (now > keyExp) {
      revokedTokens.delete(key)
    } else {
      return true
    }
  }
  return false
}

/**
 * Extracts the session token strictly from Authorization: Bearer <token>.
 */
export function extractSessionToken(c: Context): { token: string | null; source: 'header' | null } {
  const auth = c.req.header('Authorization')
  if (auth && auth.startsWith('Bearer ')) {
    const token = auth.substring(7).trim()
    if (token && token !== 'cookie') {
      return { token, source: 'header' }
    }
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
const MAX_IN_MEMORY_LOGIN_BUCKETS = 1000
const inMemoryLoginAttempts = new Map<string, MemoryBucketEntry>()

function checkAndRecordLoginAttemptInMemory(
  ipBucket: string,
  accountBucket: string,
  now: number,
  ipWindowMs: number,
  maxIpAttempts: number,
  accountWindowMs: number,
  maxAccountAttempts: number
): { allowed: boolean; retryAfterSeconds: number } {
  const ipRes = checkInMemoryBucket(inMemoryLoginAttempts, ipBucket, maxIpAttempts, ipWindowMs, now, {
    maxBuckets: MAX_IN_MEMORY_LOGIN_BUCKETS,
    strictExpiry: true
  })
  if (!ipRes.allowed) return ipRes
  return checkInMemoryBucket(inMemoryLoginAttempts, accountBucket, maxAccountAttempts, accountWindowMs, now, {
    maxBuckets: MAX_IN_MEMORY_LOGIN_BUCKETS,
    strictExpiry: true
  })
}

async function ensureLoginAttemptsTable(db: D1Database): Promise<void> {
  await db.prepare(
    'CREATE TABLE IF NOT EXISTS Login_Attempts (bucket TEXT PRIMARY KEY, attempts INTEGER NOT NULL, window_start INTEGER NOT NULL)'
  ).run()
}

async function ensureRevokedSessionsTable(db: D1Database): Promise<void> {
  await db.prepare(
    'CREATE TABLE IF NOT EXISTS Revoked_Sessions (signature TEXT PRIMARY KEY, expires_at INTEGER NOT NULL)'
  ).run()
}

async function queryD1LoginAttempts(
  db: D1Database,
  ipBucket: string,
  accountBucket: string,
  now: number,
  ipWindowMs: number,
  maxIpAttempts: number,
  accountWindowMs: number,
  maxAccountAttempts: number
): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
  const ipRes = await upsertD1RateLimitBucket(
    db, 'Login_Attempts', 'attempts', ipBucket, maxIpAttempts, ipWindowMs, now, true
  )
  if (!ipRes.allowed) return ipRes

  return upsertD1RateLimitBucket(
    db, 'Login_Attempts', 'attempts', accountBucket, maxAccountAttempts, accountWindowMs, now, true
  )
}

function expandIpv6Groups(rawIp: string): string[] | null {
  const ip = rawIp.split('%')[0].trim().toLowerCase()
  if (!ip.includes(':')) return null

  const doubleColonParts = ip.split('::')
  if (doubleColonParts.length > 2) return null

  const parseSegment = (segment: string): string[] | null => {
    if (!segment) return []
    const parts = segment.split(':')
    const out: string[] = []
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]
      if (part.includes('.')) {
        if (i !== parts.length - 1) return null
        const v4 = part.split('.')
        if (v4.length !== 4) return null
        const octets = v4.map((o) => (/^\d+$/.test(o) ? Number(o) : NaN))
        if (octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null
        out.push(((octets[0] << 8) | octets[1]).toString(16).padStart(4, '0'))
        out.push(((octets[2] << 8) | octets[3]).toString(16).padStart(4, '0'))
      } else if (/^[0-9a-f]{1,4}$/.test(part)) {
        out.push(part.padStart(4, '0'))
      } else {
        return null
      }
    }
    return out
  }

  if (doubleColonParts.length === 1) {
    const groups = parseSegment(doubleColonParts[0])
    return groups && groups.length === 8 ? groups : null
  }

  const head = parseSegment(doubleColonParts[0])
  const tail = parseSegment(doubleColonParts[1])
  if (!head || !tail || head.length + tail.length > 7) return null

  const zeros = Array.from({ length: 8 - head.length - tail.length }, () => '0000')
  return [...head, ...zeros, ...tail]
}

export function normalizeIpBucket(ip: string): string {
  const cleanIp = (ip || 'unknown').trim()
  if (cleanIp.includes(':')) {
    // Expand IPv6 (including :: compression) and group by /64 prefix to prevent prefix cycling
    const expanded = expandIpv6Groups(cleanIp)
    if (expanded) {
      return `ip:${expanded.slice(0, 4).join(':')}::/64`
    }
    const parts = cleanIp.split(':')
    return `ip:${parts.slice(0, 4).join(':')}::/64`
  }
  return `ip:${cleanIp}`
}

export async function checkAndRecordLoginAttempt(
  db: D1Database | undefined,
  ip: string,
  options?: { maxAttempts?: number; windowMs?: number }
): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
  const now = Date.now()
  const ipBucket = normalizeIpBucket(ip)
  const accountBucket = 'account'

  const IP_WINDOW_MS = options?.windowMs ?? 60 * 1000
  const MAX_IP_ATTEMPTS = options?.maxAttempts ?? 5

  const ACCOUNT_WINDOW_MS = 15 * 60 * 1000
  const MAX_ACCOUNT_ATTEMPTS = 20

  if (!db) {
    return checkAndRecordLoginAttemptInMemory(
      ipBucket, accountBucket, now, IP_WINDOW_MS, MAX_IP_ATTEMPTS, ACCOUNT_WINDOW_MS, MAX_ACCOUNT_ATTEMPTS
    )
  }

  try {
    return await queryD1LoginAttempts(
      db, ipBucket, accountBucket, now, IP_WINDOW_MS, MAX_IP_ATTEMPTS, ACCOUNT_WINDOW_MS, MAX_ACCOUNT_ATTEMPTS
    )
  } catch (firstErr) {
    try {
      await ensureLoginAttemptsTable(db)
      return await queryD1LoginAttempts(
        db, ipBucket, accountBucket, now, IP_WINDOW_MS, MAX_IP_ATTEMPTS, ACCOUNT_WINDOW_MS, MAX_ACCOUNT_ATTEMPTS
      )
    } catch (err) {
      // Isolate-scoped in-memory fallback when D1 is unavailable so rate limiting never fails completely open
      console.warn('[rate-limit] D1 rate limiter error (using isolate memory fallback):', err || firstErr)
      return checkAndRecordLoginAttemptInMemory(
        ipBucket, accountBucket, now, IP_WINDOW_MS, MAX_IP_ATTEMPTS, ACCOUNT_WINDOW_MS, MAX_ACCOUNT_ATTEMPTS
      )
    }
  }
}

export async function clearLoginAttempts(db: D1Database | undefined, ip: string): Promise<void> {
  const ipBucket = normalizeIpBucket(ip)
  inMemoryLoginAttempts.delete(ipBucket)
  inMemoryLoginAttempts.delete('account')
  if (!db) return
  try {
    await db.prepare('DELETE FROM Login_Attempts WHERE bucket IN (?, ?)').bind(ipBucket, 'account').run()
  } catch {}
}

/**
 * Atomically consumes a one-time token digest in Revoked_Sessions for replay protection.
 * Returns true only on first use (meta.changes > 0); returns false on replay or DB failure.
 */
export async function consumeOneTimeTokenDigest(
  db: D1Database | undefined,
  rawToken: string,
  expiresAtSec: number
): Promise<boolean> {
  if (!db || !rawToken) return false

  try {
    const digestBytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(rawToken))
    const tokenKey = `oauth_replay:${bytesToHex(new Uint8Array(digestBytes))}`
    const expiresAtMs = Number.isFinite(expiresAtSec) && expiresAtSec > 0
      ? Math.floor(expiresAtSec * 1000)
      : Date.now() + 3600_000

    const insertReplay = () =>
      db.prepare('INSERT OR IGNORE INTO Revoked_Sessions (signature, expires_at) VALUES (?, ?)')
        .bind(tokenKey, expiresAtMs)
        .run()

    let res: D1Result<unknown>
    try {
      res = await insertReplay()
    } catch {
      await ensureRevokedSessionsTable(db)
      res = await insertReplay()
    }

    return Boolean(res?.meta?.changes && res.meta.changes > 0)
  } catch (err) {
    console.warn('[auth] One-time token replay check failed (failing closed):', err)
    return false
  }
}

/**
 * Revokes a session token in D1 database (Revoked_Sessions table) and updates local in-memory cache immediately.
 */
export async function revokeTokenInDb(db: D1Database | undefined, token: string): Promise<void> {
  if (!token) return
  // Immediately update local in-memory cache
  revokeSessionToken(token)
  const key = getTokenKey(token)

  if (!db) return

  try {
    const now = Date.now()
    const expiry = now + SESSION_TTL_MS

    // Insert into dedicated Revoked_Sessions table (Finding 3)
    await db.prepare(
      'INSERT OR IGNORE INTO Revoked_Sessions (signature, expires_at) VALUES (?, ?)'
    ).bind(key, expiry).run().catch(async () => {
      // Fallback if table not yet initialized
      await ensureRevokedSessionsTable(db).catch(() => {})
      await db.prepare(
        'INSERT OR IGNORE INTO Revoked_Sessions (signature, expires_at) VALUES (?, ?)'
      ).bind(key, expiry).run()
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
 * Checks whether a token is revoked directly against D1 (and in-memory known-revoked set).
 * Fails closed by rejecting/throwing on D1 errors or missing DB binding.
 */
export async function isTokenRevokedInDb(db: D1Database | undefined, token: string): Promise<boolean> {
  if (!token) return true
  const now = Date.now()

  // 1. In-memory check for known revoked tokens
  if (isTokenRevoked(token)) return true
  const key = getTokenKey(token)
  if (isTokenRevoked(key)) return true

  if (!db) {
    throw new Error('D1 database binding is required for revocation check')
  }

  const row = await db.prepare(
    'SELECT 1 FROM Revoked_Sessions WHERE signature = ? AND expires_at > ? LIMIT 1'
  ).bind(key, now).first()

  if (row) {
    revokeSessionToken(token)
    revokeSessionToken(key)
    return true
  }

  return false
}

/**
 * Retrieves sessions_valid_after timestamp directly from D1 (no stale isolate cache).
 * Fails closed by rejecting/throwing on D1 errors or missing DB binding.
 */
export async function getSessionsValidAfter(db: D1Database | undefined): Promise<number> {
  if (!db) {
    throw new Error('D1 database binding is required for sessions_valid_after check')
  }

  const row = await db.prepare(
    "SELECT setting_value FROM Admin_Settings WHERE setting_key = 'sessions_valid_after'"
  ).first<{ setting_value: string }>()

  if (!row || row.setting_value === null || row.setting_value === undefined || row.setting_value === '') {
    return 0
  }

  const parsed = Number(row.setting_value)
  if (!Number.isFinite(parsed)) {
    throw new Error('Invalid sessions_valid_after setting value')
  }
  return parsed
}

export type AdminSessionVerificationResult =
  | { ok: true; email: string; issuedAt: number; jti?: string; token: string }
  | { ok: false; status: 401 | 500 | 503; code: string; message: string }

/**
 * Performs complete admin session verification:
 * Bearer extraction, signing secret check, HMAC signature & expiry, constant-time ADMIN_EMAIL match,
 * and fail-closed D1 revocation + sessions_valid_after checks.
 */
export async function verifyAdminSessionRequest(
  c: Context<{ Bindings: Bindings }>
): Promise<AdminSessionVerificationResult> {
  const signingSecret = getSigningSecret(c.env)
  if (!signingSecret) {
    return {
      ok: false,
      status: 500,
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Server authentication is not configured.'
    }
  }

  const adminEmail = (c.env.ADMIN_EMAIL || '').trim().toLowerCase()
  if (!adminEmail) {
    console.error('[auth] Server misconfigured: ADMIN_EMAIL is unset or empty')
    return {
      ok: false,
      status: 500,
      code: 'SERVER_MISCONFIGURED',
      message: 'Server misconfigured'
    }
  }

  const { token } = extractSessionToken(c)
  if (!token) {
    return {
      ok: false,
      status: 401,
      code: 'UNAUTHORIZED',
      message: 'Authentication required. Provide a valid Authorization header.'
    }
  }

  const session = await verifySessionToken(token, signingSecret)
  if (!session.valid) {
    return {
      ok: false,
      status: 401,
      code: 'UNAUTHORIZED',
      message: 'Invalid or expired session token.'
    }
  }

  const sessionEmail = session.email ? session.email.trim().toLowerCase() : ''
  if (!sessionEmail || !timingSafeEqual(sessionEmail, adminEmail)) {
    return {
      ok: false,
      status: 401,
      code: 'UNAUTHORIZED',
      message: 'Invalid or expired session token.'
    }
  }

  let isRevoked: boolean
  let validAfter: number
  try {
    ;[isRevoked, validAfter] = await Promise.all([
      isTokenRevokedInDb(c.env.DB, token),
      getSessionsValidAfter(c.env.DB)
    ])
  } catch (err) {
    console.error('[auth] D1 session state verification failed (failing closed):', err)
    return {
      ok: false,
      status: 503,
      code: 'SERVICE_UNAVAILABLE',
      message: 'Authentication verification is temporarily unavailable.'
    }
  }

  if (isRevoked) {
    return {
      ok: false,
      status: 401,
      code: 'UNAUTHORIZED',
      message: 'Invalid or expired session token.'
    }
  }

  if (validAfter && session.issuedAt !== undefined && session.issuedAt < validAfter) {
    return {
      ok: false,
      status: 401,
      code: 'UNAUTHORIZED',
      message: 'Session has been revoked due to password change or logout everywhere.'
    }
  }

  return {
    ok: true,
    email: sessionEmail,
    issuedAt: session.issuedAt ?? 0,
    ...(session.jti ? { jti: session.jti } : {}),
    token
  }
}

/**
 * Middleware that strictly checks for a valid HMAC-signed session token.
 * Fails closed if session signing secret is not configured or < 32 characters,
 * if ADMIN_EMAIL is unset/empty, or if D1 session verification fails.
 */
export const adminAuth = async (c: Context<{ Bindings: Bindings }>, next: Next) => {
  const result = await verifyAdminSessionRequest(c)
  if (!result.ok) {
    if (result.code === 'SERVER_MISCONFIGURED') {
      return c.json({
        error: 'Server misconfigured',
        message: 'Server misconfigured'
      }, 500)
    }
    return c.json({
      error: {
        code: result.code,
        message: result.message,
        details: []
      }
    }, result.status)
  }

  return await next()
}

export const authMiddleware = adminAuth
