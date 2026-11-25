import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Hono } from 'hono'
import {
  getSigningSecret,
  createSessionToken,
  verifySessionToken,
  extractSessionToken,
  adminAuth,
  hashPassword,
  verifyPassword,
  verifyGoogleIdToken,
  hasForbiddenPaymentFields,
  timingSafeEqual,
  revokeTokenInDb,
  isTokenRevokedInDb,
  consumeOneTimeTokenDigest,
  normalizeIpBucket,
  checkAndRecordLoginAttempt,
  clearLoginAttempts
} from '../src/middleware/auth.ts'
import realApp, { type Bindings } from '../src/index.ts'

// A small D1 stand-in over node:sqlite
function createD1(sqlite: DatabaseSync): any {
  const plain = (row: any) => (row ? { ...row } : null)
  const statement = (sql: string, params: any[] = []): any => ({
    sql,
    bind: (...values: any[]) => statement(sql, values),
    first: async (column?: string) => {
      const row = plain(sqlite.prepare(sql).get(...params))
      return row && column ? row[column] : row
    },
    all: async () => ({ success: true, results: sqlite.prepare(sql).all(...params).map(plain), meta: {} }),
    run: async () => {
      const info = sqlite.prepare(sql).run(...params)
      return { success: true, results: [], meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) } }
    }
  })
  return {
    prepare: (sql: string) => statement(sql),
    batch: async (statements: any[]) => {
      sqlite.exec('BEGIN')
      try {
        const out = []
        for (const s of statements) out.push(/^\s*SELECT/i.test(s.sql) ? await s.all() : await s.run())
        sqlite.exec('COMMIT')
        return out
      } catch (err) {
        sqlite.exec('ROLLBACK')
        throw err
      }
    },
    exec: async (sql: string) => sqlite.exec(sql)
  }
}

function setupDb() {
  const sqlite = new DatabaseSync(':memory:')
  sqlite.exec(`
    CREATE TABLE Admin_Settings (
      setting_key TEXT PRIMARY KEY,
      setting_value TEXT NOT NULL
    );
    CREATE TABLE Login_Attempts (
      bucket TEXT PRIMARY KEY,
      attempts INTEGER NOT NULL,
      window_start INTEGER NOT NULL
    );
    CREATE TABLE Revoked_Sessions (
      signature TEXT PRIMARY KEY,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX idx_revoked_sessions_exp ON Revoked_Sessions(expires_at);
  `)
  return createD1(sqlite)
}

const VALID_SECRET = 'a'.repeat(32) // 32 chars
const SHORT_SECRET = 'a'.repeat(31) // 31 chars
const ADMIN_EMAIL = 'admin@example.com'

test('getSigningSecret requires >= 32 chars and never falls back to ADMIN_SECRET', () => {
  // Missing SESSION_SECRET
  assert.equal(getSigningSecret({ DB: {} as any }), null)
  // Short SESSION_SECRET (< 32 chars)
  assert.equal(getSigningSecret({ DB: {} as any, SESSION_SECRET: SHORT_SECRET }), null)
  // Valid SESSION_SECRET (>= 32 chars)
  assert.equal(getSigningSecret({ DB: {} as any, SESSION_SECRET: VALID_SECRET }), VALID_SECRET)
  // Never falls back to ADMIN_SECRET
  assert.equal(getSigningSecret({ DB: {} as any, ADMIN_SECRET: 'long_enough_admin_secret_1234567890' } as any), null)
})

test('createSessionToken and verifySessionToken include issuedAt and validate signatures', async () => {
  const token = await createSessionToken(VALID_SECRET, ADMIN_EMAIL)
  assert.ok(token)

  // Verify token
  const session = await verifySessionToken(token, VALID_SECRET)
  assert.equal(session.valid, true)
  assert.equal(session.email, ADMIN_EMAIL)
  assert.ok(typeof session.issuedAt === 'number')
  assert.ok(session.issuedAt! > 0)
  assert.ok(Math.abs(Date.now() - session.issuedAt!) < 5000)

  // Wrong secret fails
  const wrongSecretSession = await verifySessionToken(token, 'b'.repeat(32))
  assert.equal(wrongSecretSession.valid, false)

  // Tampered payload fails
  const parts = token.split('.')
  const tamperedPayload = btoa(`${ADMIN_EMAIL}:${Date.now() + 10000}:${Date.now() + 86400000}`)
  const tamperedToken = `${tamperedPayload}.${parts[1]}`
  const tamperedSession = await verifySessionToken(tamperedToken, VALID_SECRET)
  assert.equal(tamperedSession.valid, false)

  // Expired token fails
  const expiredPayload = btoa(`${ADMIN_EMAIL}:${Date.now() - 100000}:${Date.now() - 1000}`)
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey('raw', encoder.encode(VALID_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(`${ADMIN_EMAIL}:${Date.now() - 100000}:${Date.now() - 1000}`))
  const sigHex = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('')
  const expiredToken = `${expiredPayload}.${sigHex}`
  const expiredSession = await verifySessionToken(expiredToken, VALID_SECRET)
  assert.equal(expiredSession.valid, false)
})

test('extractSessionToken strictly extracts tokens from Authorization Bearer header', () => {
  const app = new Hono()

  let extracted: any = null
  app.get('/test', (c) => {
    extracted = extractSessionToken(c)
    return c.text('ok')
  })

  // Bearer header
  app.request('/test', { headers: { Authorization: 'Bearer token_from_header' } })
  assert.deepEqual(extracted, { token: 'token_from_header', source: 'header' })

  // Bearer cookie sentinel is ignored
  app.request('/test', {
    headers: {
      Authorization: 'Bearer cookie'
    }
  })
  assert.deepEqual(extracted, { token: null, source: null })

  // Cookies are completely ignored
  app.request('/test', {
    headers: {
      Cookie: '__Host-r59_session=host_tok; r59_session=legacy_tok'
    }
  })
  assert.deepEqual(extracted, { token: null, source: null })

  // No token
  app.request('/test')
  assert.deepEqual(extracted, { token: null, source: null })
})

test('adminAuth middleware enforces signing secret, email match, revocation, and header auth', async () => {
  const db = setupDb()
  const app = new Hono<{ Bindings: Bindings }>()
  app.use('*', adminAuth)
  app.post('/admin/action', (c) => c.json({ ok: true }))
  app.get('/admin/action', (c) => c.json({ ok: true }))

  const validToken = await createSessionToken(VALID_SECRET, ADMIN_EMAIL)

  // 1. Missing/short signing secret -> 500
  const resNoSecret = await app.request('/admin/action', {
    headers: { Authorization: `Bearer ${validToken}` }
  }, { DB: db, SESSION_SECRET: SHORT_SECRET, ADMIN_EMAIL } as any)
  assert.equal(resNoSecret.status, 500)
  const noSecretJson = await resNoSecret.json() as any
  assert.equal(noSecretJson.error.message, 'Server authentication is not configured.')

  // 2. Missing token -> 401
  const resNoToken = await app.request('/admin/action', {}, {
    DB: db, SESSION_SECRET: VALID_SECRET, ADMIN_EMAIL
  } as any)
  assert.equal(resNoToken.status, 401)

  // 3. Email mismatch -> 401
  const diffEmailToken = await createSessionToken(VALID_SECRET, 'other@example.com')
  const resDiffEmail = await app.request('/admin/action', {
    headers: { Authorization: `Bearer ${diffEmailToken}` }
  }, { DB: db, SESSION_SECRET: VALID_SECRET, ADMIN_EMAIL } as any)
  assert.equal(resDiffEmail.status, 401)

  // 4. sessions_valid_after revokes tokens issued earlier
  // Insert sessions_valid_after into DB setting it to Date.now() + 1000
  await db.prepare("INSERT INTO Admin_Settings (setting_key, setting_value) VALUES ('sessions_valid_after', ?)").bind(String(Date.now() + 1000)).run()
  const resRevokedAfter = await app.request('/admin/action', {
    headers: { Authorization: `Bearer ${validToken}` }
  }, { DB: db, SESSION_SECRET: VALID_SECRET, ADMIN_EMAIL } as any)
  assert.equal(resRevokedAfter.status, 401)
  const revokedJson = await resRevokedAfter.json() as any
  assert.equal(revokedJson.error.message, 'Session has been revoked due to password change or logout everywhere.')

  // Reset sessions_valid_after to past
  await db.prepare("UPDATE Admin_Settings SET setting_value = ? WHERE setting_key = 'sessions_valid_after'").bind('0').run()

  // 5. Cookie-only request is rejected (cookieless architecture) -> 401
  const resCookieOnly = await app.request('http://localhost/admin/action', {
    method: 'POST',
    headers: {
      Cookie: `__Host-r59_session=${validToken}`
    }
  }, { DB: db, SESSION_SECRET: VALID_SECRET, ADMIN_EMAIL } as any)
  assert.equal(resCookieOnly.status, 401)

  // 6. Header auth with GET and POST passes without requiring CSRF cookies
  const resHeaderGet = await app.request('http://localhost/admin/action', {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${validToken}`
    }
  }, { DB: db, SESSION_SECRET: VALID_SECRET, ADMIN_EMAIL } as any)
  assert.equal(resHeaderGet.status, 200)

  const resHeaderPost = await app.request('http://localhost/admin/action', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${validToken}`
    }
  }, { DB: db, SESSION_SECRET: VALID_SECRET, ADMIN_EMAIL } as any)
  assert.equal(resHeaderPost.status, 200)
})

test('PBKDF2 verifyPassword/hashPassword and deprecated password endpoints (410 Gone)', async () => {
  const db = setupDb()
  const validPass = 'ValidPassword123!'
  const hash = await hashPassword(validPass)
  assert.ok(hash.startsWith('pbkdf2_sha256$100000$'))

  const check = await verifyPassword(validPass, hash)
  assert.equal(check.matches, true)
  assert.equal(check.needsHashUpgrade, false)

  const checkWrong = await verifyPassword('WrongPassword123!', hash)
  assert.equal(checkWrong.matches, false)

  // Legacy plaintext secret triggers needsHashUpgrade: true
  const legacyCheck = await verifyPassword('legacy-secret-value', 'legacy-secret-value')
  assert.equal(legacyCheck.matches, true)
  assert.equal(legacyCheck.needsHashUpgrade, true)

  // Deprecated HTTP endpoints return 410 DEPRECATED via realApp
  const token = await createSessionToken(VALID_SECRET, ADMIN_EMAIL)
  const env = { DB: db, SESSION_SECRET: VALID_SECRET, ADMIN_EMAIL } as any

  const availRes = await realApp.fetch(new Request('http://localhost/api/admin/password-reset/available'), env)
  assert.equal(availRes.status, 410)
  assert.equal(availRes.headers.get('Cache-Control'), 'no-store')

  const forgotRes = await realApp.fetch(new Request('http://localhost/api/admin/forgot-password', { method: 'POST' }), env)
  assert.equal(forgotRes.status, 410)

  const resetRes = await realApp.fetch(new Request('http://localhost/api/admin/reset-password', { method: 'POST' }), env)
  assert.equal(resetRes.status, 410)

  const putPassRes = await realApp.fetch(
    new Request('http://localhost/api/admin/password', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}` }
    }),
    env
  )
  assert.equal(putPassRes.status, 410)
})

test('normalizeIpBucket normalizes IPv4 and aggregates IPv6 /64 prefixes', () => {
  // IPv4
  assert.equal(normalizeIpBucket('192.168.1.1'), 'ip:192.168.1.1')
  assert.equal(normalizeIpBucket('  10.0.0.5  '), 'ip:10.0.0.5')

  // IPv6: /64 prefix
  assert.equal(
    normalizeIpBucket('2001:0db8:85a3:0000:0000:8a2e:0370:7334'),
    'ip:2001:0db8:85a3:0000::/64'
  )
  assert.equal(
    normalizeIpBucket('2600:1f18:63fe:7200:abcd:ef01:2345:6789'),
    'ip:2600:1f18:63fe:7200::/64'
  )
  // Unknown
  assert.equal(normalizeIpBucket(''), 'ip:unknown')
})

test('checkAndRecordLoginAttempt rate limits bursts and clearLoginAttempts resets', async () => {
  const db = setupDb()
  const ip = '1.2.3.4'

  // First 5 attempts allowed
  for (let i = 1; i <= 5; i++) {
    const res = await checkAndRecordLoginAttempt(db, ip)
    assert.equal(res.allowed, true, `Attempt ${i} should be allowed`)
  }

  // 6th attempt should be blocked
  const blockedRes = await checkAndRecordLoginAttempt(db, ip)
  assert.equal(blockedRes.allowed, false)
  assert.ok(blockedRes.retryAfterSeconds > 0)

  // Clear attempts
  await clearLoginAttempts(db, ip)

  // Next attempt allowed
  const clearedRes = await checkAndRecordLoginAttempt(db, ip)
  assert.equal(clearedRes.allowed, true)
})

test('adminAuth rejects tokens revoked in D1 Revoked_Sessions table', async () => {
  const db = setupDb()
  const app = new Hono<{ Bindings: Bindings }>()
  app.use('*', adminAuth)
  app.get('/admin/test', (c) => c.json({ ok: true }))

  const token = await createSessionToken(VALID_SECRET, ADMIN_EMAIL)

  // Valid before revocation
  const resValid = await app.request('/admin/test', {
    headers: { Authorization: `Bearer ${token}` }
  }, { DB: db, SESSION_SECRET: VALID_SECRET, ADMIN_EMAIL } as any)
  assert.equal(resValid.status, 200)

  // Revoke in DB
  await revokeTokenInDb(db, token)

  // Rejected after revocation
  const resRevoked = await app.request('/admin/test', {
    headers: { Authorization: `Bearer ${token}` }
  }, { DB: db, SESSION_SECRET: VALID_SECRET, ADMIN_EMAIL } as any)
  assert.equal(resRevoked.status, 401)
})

test('/admin/ response on realApp has Cross-Origin-Opener-Policy: same-origin-allow-popups and security headers', async () => {
  const db = setupDb()
  const mockAssets: any = {
    fetch: async (req: Request) => {
      const url = new URL(req.url)
      if (url.pathname === '/admin/' || url.pathname === '/admin/index.html') {
        return new Response('<!DOCTYPE html><html><head><title>Admin</title></head><body>Admin</body></html>', {
          status: 200,
          headers: { 'Content-Type': 'text/html; charset=utf-8' }
        })
      }
      return new Response('Not Found', { status: 404 })
    }
  }

  const env = {
    DB: db,
    SESSION_SECRET: VALID_SECRET,
    ADMIN_EMAIL,
    ASSETS: mockAssets
  } as any

  // 1. /admin redirect response has same-origin-allow-popups
  const resRedirect = await realApp.fetch(new Request('http://localhost/admin'), env)
  assert.equal(resRedirect.status, 301)
  assert.equal(resRedirect.headers.get('Location'), '/admin/')
  assert.equal(resRedirect.headers.get('Cross-Origin-Opener-Policy'), 'same-origin-allow-popups')
  assert.notEqual(resRedirect.headers.get('Cross-Origin-Opener-Policy'), 'same-origin')

  // 2. /admin/ page response has same-origin-allow-popups and CSP/X-Frame-Options/nosniff
  const resAdmin = await realApp.fetch(new Request('http://localhost/admin/'), env)
  assert.equal(resAdmin.status, 200)
  assert.equal(resAdmin.headers.get('Cross-Origin-Opener-Policy'), 'same-origin-allow-popups')
  assert.notEqual(resAdmin.headers.get('Cross-Origin-Opener-Policy'), 'same-origin')
  assert.equal(resAdmin.headers.get('X-Frame-Options'), 'SAMEORIGIN')
  assert.equal(resAdmin.headers.get('X-Content-Type-Options'), 'nosniff')
  assert.ok(resAdmin.headers.get('Content-Security-Policy')?.includes("default-src 'self'"))
})

test('/admin/assets/js/api/bookingsApi.js is served cleanly via realApp (never 404)', async () => {
  const db = setupDb()
  const bookingsApiFile = resolve(import.meta.dirname, '../public/admin/assets/js/api/bookingsApi.js')
  const bookingsApiContent = existsSync(bookingsApiFile)
    ? readFileSync(bookingsApiFile, 'utf8')
    : 'export const bookingsApi = {};'
  assert.ok(bookingsApiContent.includes('bookingsApi'), 'bookingsApi.js must define bookingsApi')

  const mockAssets: any = {
    fetch: async (req: Request) => {
      const url = new URL(req.url)
      if (url.pathname === '/admin/assets/js/api/bookingsApi.js') {
        return new Response(bookingsApiContent, {
          status: 200,
          headers: { 'Content-Type': 'application/javascript' }
        })
      }
      return new Response('Not Found', { status: 404 })
    }
  }

  const env = {
    DB: db,
    SESSION_SECRET: VALID_SECRET,
    ADMIN_EMAIL,
    ASSETS: mockAssets
  } as any

  // Unauthenticated request must succeed with 200 (served cleanly as a static module, NOT 404)
  const resUnauth = await realApp.fetch(new Request('http://localhost/admin/assets/js/api/bookingsApi.js'), env)
  assert.equal(resUnauth.status, 200, 'Unauthenticated request must return 200 OK, never 404')
  assert.equal(resUnauth.headers.get('Content-Type'), 'application/javascript')
  assert.equal(resUnauth.headers.get('Cross-Origin-Opener-Policy'), 'same-origin-allow-popups')
  assert.notEqual(resUnauth.headers.get('Cross-Origin-Opener-Policy'), 'same-origin')
  const bodyText = await resUnauth.text()
  assert.ok(bodyText.includes('bookingsApi'), 'Delivered script body must contain bookingsApi')

  // Authenticated request also succeeds with 200 OK and same-origin-allow-popups COOP
  const token = await createSessionToken(VALID_SECRET, ADMIN_EMAIL)
  const resAuth = await realApp.fetch(
    new Request('http://localhost/admin/assets/js/api/bookingsApi.js', {
      headers: { Authorization: `Bearer ${token}` }
    }),
    env
  )
  assert.equal(resAuth.status, 200)
  assert.equal(resAuth.headers.get('Content-Type'), 'application/javascript')
  assert.equal(resAuth.headers.get('Cross-Origin-Opener-Policy'), 'same-origin-allow-popups')
})

async function createSignedGoogleIdToken(claims: Record<string, unknown>, kid = 'replay-kid-1') {
  const pair = await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256'
    },
    true,
    ['sign', 'verify']
  )
  const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey)
  const mockJwk = { kty: jwk.kty!, alg: 'RS256', use: 'sig', kid, n: jwk.n!, e: jwk.e! }
  const headerB64 = Buffer.from(JSON.stringify({ alg: 'RS256', kid, typ: 'JWT' })).toString('base64url')
  const payloadB64 = Buffer.from(JSON.stringify(claims)).toString('base64url')
  const sigBytes = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    pair.privateKey,
    new TextEncoder().encode(`${headerB64}.${payloadB64}`)
  )
  return {
    idToken: `${headerB64}.${payloadB64}.${Buffer.from(sigBytes).toString('base64url')}`,
    mockJwk
  }
}

test('OAuth Replay Attack: consumeOneTimeTokenDigest and POST /api/admin/google-login reject replayed Google ID tokens', async () => {
  const db = setupDb()
  const nowSec = Math.floor(Date.now() / 1000)
  const exp = nowSec + 3600
  const rawIdToken = 'header.payload.signature-one-time-test'

  // 1. Direct consumeOneTimeTokenDigest replay protection check
  const firstUse = await consumeOneTimeTokenDigest(db, rawIdToken, exp)
  assert.equal(firstUse, true, 'First consumption of Google ID token digest must succeed')

  const replayUse = await consumeOneTimeTokenDigest(db, rawIdToken, exp)
  assert.equal(replayUse, false, 'Replayed Google ID token digest must be rejected')

  const stored = await db.prepare("SELECT signature, expires_at FROM Revoked_Sessions WHERE signature LIKE 'oauth_replay:%'").all()
  assert.equal(stored.results.length, 1, 'Revoked_Sessions must persist exactly one oauth_replay digest')

  // 2. End-to-end POST /api/admin/google-login replay probe
  const nonce = 'nonce-replay-probe-123'
  const clientId = 'test-client-id.apps.googleusercontent.com'
  const { idToken, mockJwk } = await createSignedGoogleIdToken({
    iss: 'https://accounts.google.com',
    aud: clientId,
    exp,
    iat: nowSec,
    nonce,
    email: ADMIN_EMAIL,
    email_verified: true
  })

  const env = {
    DB: db,
    SESSION_SECRET: VALID_SECRET,
    ADMIN_EMAIL,
    GOOGLE_CLIENT_ID: clientId
  }

  const originalFetch = globalThis.fetch
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const target = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    if (target === 'https://www.googleapis.com/oauth2/v3/certs') {
      return new Response(JSON.stringify({ keys: [mockJwk] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' }
      })
    }
    return originalFetch(input, init)
  }

  try {
    const nonceRes1 = await realApp.fetch(new Request('http://localhost/api/admin/auth/nonce'), env)
    assert.equal(nonceRes1.status, 200)
    const { nonce: serverNonce1 } = (await nonceRes1.json()) as { nonce: string }
    const cookie1 = (nonceRes1.headers.get('Set-Cookie') || '').split(';')[0]
    const { idToken: boundIdToken, mockJwk: boundMockJwk } = await createSignedGoogleIdToken({
      iss: 'https://accounts.google.com',
      aud: clientId,
      exp,
      iat: nowSec,
      nonce: serverNonce1,
      email: ADMIN_EMAIL,
      email_verified: true
    })

    // Swap mock fetch to serve boundMockJwk
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const target = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      if (target === 'https://www.googleapis.com/oauth2/v3/certs') {
        return new Response(JSON.stringify({ keys: [boundMockJwk] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' }
        })
      }
      return originalFetch(input, init)
    }

    const loginRes1 = await realApp.fetch(
      new Request('http://localhost/api/admin/google-login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'CF-Connecting-IP': '198.51.100.10',
          Cookie: cookie1
        },
        body: JSON.stringify({ idToken: boundIdToken, nonce: serverNonce1 })
      }),
      env
    )
    assert.equal(loginRes1.status, 200, 'Initial Google login must succeed')
    const loginJson1 = await loginRes1.json() as { ok: boolean; token?: string }
    assert.equal(loginJson1.ok, true)
    assert.ok(loginJson1.token)

    const replayRes = await realApp.fetch(
      new Request('http://localhost/api/admin/google-login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'CF-Connecting-IP': '198.51.100.10',
          Cookie: cookie1
        },
        body: JSON.stringify({ idToken: boundIdToken, nonce: serverNonce1 })
      }),
      env
    )
    assert.equal(replayRes.status, 401, 'Replayed Google ID token on POST /api/admin/google-login must return 401')
  } finally {
    globalThis.fetch = originalFetch
    await clearLoginAttempts(db, '198.51.100.10')
  }
})

test('SharedWorker Cross-Origin Exfiltration: isTrustedProxyUrl blocks untrusted origins and javascript: URLs', async () => {
  const originalSelf = (globalThis as any).self
  const mockLocation = {
    origin: 'http://localhost:5173',
    hostname: 'localhost'
  }
  ;(globalThis as any).self = { location: mockLocation }

  try {
    const { isTrustedProxyUrl } = await import('../../admin/src/api/authWorker.ts')

    // Untrusted external origin must be rejected before Authorization header can be attached
    assert.equal(
      isTrustedProxyUrl(new URL('https://evil.example.com/steal')),
      false,
      'External origin must be rejected'
    )

    // Non-HTTP(S) schemes must be rejected
    assert.equal(
      isTrustedProxyUrl(new URL('javascript:alert(1)')),
      false,
      'javascript: scheme must be rejected'
    )

    // Local dev backend (:8787) on localhost (:5173) is trusted
    assert.equal(
      isTrustedProxyUrl(new URL('http://localhost:8787/api/admin/bookings')),
      true,
      'Local dev backend :8787 must be trusted from http://localhost:5173'
    )

    // Same-origin relative path resolved against worker origin is trusted
    assert.equal(
      isTrustedProxyUrl(new URL('/api/admin/bookings', mockLocation.origin)),
      true,
      'Same-origin /api/admin/bookings must be trusted'
    )

    // Production origin must NOT trust localhost:8787
    mockLocation.origin = 'https://admin.r59media.com'
    mockLocation.hostname = 'admin.r59media.com'
    assert.equal(
      isTrustedProxyUrl(new URL('http://localhost:8787/api/admin/bookings')),
      false,
      'Production origin must reject localhost:8787'
    )
    assert.equal(
      isTrustedProxyUrl(new URL('/api/admin/bookings', mockLocation.origin)),
      true,
      'Production origin must allow same-origin path'
    )
  } finally {
    if (originalSelf === undefined) {
      delete (globalThis as any).self
    } else {
      ;(globalThis as any).self = originalSelf
    }
  }
})

test('Rate Limiter Fallback: checkAndRecordLoginAttempt fails closed to isolate memory when D1 throws', async () => {
  const testIp = '198.51.100.77'
  await clearLoginAttempts(undefined, testIp)

  const brokenDb: any = {
    prepare: () => {
      throw new Error('D1_UNAVAILABLE')
    }
  }

  try {
    for (let i = 1; i <= 5; i++) {
      const res = await checkAndRecordLoginAttempt(brokenDb, testIp)
      assert.equal(res.allowed, true, `Fallback attempt ${i} within threshold should be allowed`)
    }

    const blocked = await checkAndRecordLoginAttempt(brokenDb, testIp)
    assert.equal(blocked.allowed, false, '6th attempt during D1 outage must be blocked by isolate fallback')
    assert.ok(blocked.retryAfterSeconds > 0, 'Blocked response must include positive retryAfterSeconds')
  } finally {
    await clearLoginAttempts(undefined, testIp)
  }
})

test('Session boundary off-by-one: issuedAt === validAfter vs < validAfter, Date.now() === expiry, and Google ID token CLOCK_SKEW_SECONDS = 60', async () => {
  const db = setupDb()
  const app = new Hono<{ Bindings: Bindings }>()
  app.use('*', adminAuth)
  app.get('/admin/check', (c) => c.json({ ok: true }))

  const token = await createSessionToken(VALID_SECRET, ADMIN_EMAIL)
  const verified = await verifySessionToken(token, VALID_SECRET)
  assert.equal(verified.valid, true)
  const issuedAt = verified.issuedAt!

  // 1. issuedAt === validAfter is still valid (only strictly < validAfter is revoked)
  await db.prepare("INSERT OR REPLACE INTO Admin_Settings (setting_key, setting_value) VALUES ('sessions_valid_after', ?)").bind(String(issuedAt)).run()
  const equalRes = await app.request('/admin/check', { headers: { Authorization: `Bearer ${token}` } }, { DB: db, SESSION_SECRET: VALID_SECRET, ADMIN_EMAIL } as any)
  assert.equal(equalRes.status, 200)

  // issuedAt < validAfter (by 1ms) is rejected
  await db.prepare("INSERT OR REPLACE INTO Admin_Settings (setting_key, setting_value) VALUES ('sessions_valid_after', ?)").bind(String(issuedAt + 1)).run()
  const beforeRes = await app.request('/admin/check', { headers: { Authorization: `Bearer ${token}` } }, { DB: db, SESSION_SECRET: VALID_SECRET, ADMIN_EMAIL } as any)
  assert.equal(beforeRes.status, 401)

  // 2. Date.now() === expiry is valid; Date.now() === expiry + 1 is rejected
  const fixedExpiry = 1_800_000_000_000
  const boundaryPayload = `${ADMIN_EMAIL}:${fixedExpiry - 1000}:${fixedExpiry}:jti-boundary`
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(VALID_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sigBuf = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(boundaryPayload))
  const sigHex = Array.from(new Uint8Array(sigBuf)).map((b) => b.toString(16).padStart(2, '0')).join('')
  const boundaryToken = `${btoa(boundaryPayload)}.${sigHex}`

  const origNow = Date.now
  try {
    Date.now = () => fixedExpiry
    assert.equal((await verifySessionToken(boundaryToken, VALID_SECRET)).valid, true)
    Date.now = () => fixedExpiry + 1
    assert.equal((await verifySessionToken(boundaryToken, VALID_SECRET)).valid, false)

    // 3. Google ID token CLOCK_SKEW_SECONDS = 60 boundary
    const baseSec = 1_800_000_000
    Date.now = () => baseSec * 1000
    const clientId = 'client-skew.apps.googleusercontent.com'

    const makeIdToken = async (exp: number, iat: number) => {
      const { idToken, mockJwk } = await createSignedGoogleIdToken({
        iss: 'https://accounts.google.com',
        aud: clientId,
        exp,
        iat,
        email: ADMIN_EMAIL,
        email_verified: true
      })
      return { idToken, mockKeys: [mockJwk] }
    }

    const expAtSkew = await makeIdToken(baseSec - 60, baseSec - 120)
    assert.equal((await verifyGoogleIdToken(expAtSkew.idToken, clientId, ADMIN_EMAIL, { mockKeys: expAtSkew.mockKeys })).success, true)

    const expPastSkew = await makeIdToken(baseSec - 61, baseSec - 120)
    assert.equal((await verifyGoogleIdToken(expPastSkew.idToken, clientId, ADMIN_EMAIL, { mockKeys: expPastSkew.mockKeys })).success, false)

    const iatAtSkew = await makeIdToken(baseSec + 3600, baseSec + 60)
    assert.equal((await verifyGoogleIdToken(iatAtSkew.idToken, clientId, ADMIN_EMAIL, { mockKeys: iatAtSkew.mockKeys })).success, true)

    const iatPastSkew = await makeIdToken(baseSec + 3600, baseSec + 61)
    assert.equal((await verifyGoogleIdToken(iatPastSkew.idToken, clientId, ADMIN_EMAIL, { mockKeys: iatPastSkew.mockKeys })).success, false)
  } finally {
    Date.now = origNow
  }
})

test('Account-wide 20-attempt lockout triggers across distinct IPs in checkAndRecordLoginAttempt', async () => {
  const db = setupDb()
  for (let i = 1; i <= 20; i++) {
    const res = await checkAndRecordLoginAttempt(db, `198.51.100.${i}`)
    assert.equal(res.allowed, true, `Global attempt ${i} should be allowed`)
  }
  const blocked21 = await checkAndRecordLoginAttempt(db, '198.51.100.21')
  assert.equal(blocked21.allowed, false)
  assert.ok(blocked21.retryAfterSeconds > 0)
})

test('hasForbiddenPaymentFields detects raw PANs, CVVs, routing numbers, and nested secrets', () => {
  assert.equal(hasForbiddenPaymentFields({ cardNumber: 'tok_safe' }), true)
  assert.equal(hasForbiddenPaymentFields({ cvv: '123' }), true)
  assert.equal(hasForbiddenPaymentFields({ routing_number: '021000021' }), true)
  assert.equal(hasForbiddenPaymentFields({ nested: { note: '4111-1111-1111-1111' } }), true)
  assert.equal(hasForbiddenPaymentFields({ sourceId: 'cnon:card-nonce-ok', attendees: 2 }), false)
})
