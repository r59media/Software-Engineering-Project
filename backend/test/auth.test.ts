import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { Hono } from 'hono'
import {
  getSigningSecret,
  createSessionToken,
  verifySessionToken,
  extractSessionToken,
  adminAuth,
  hashPassword,
  verifyPassword,
  timingSafeEqual,
  revokeTokenInDb,
  normalizeIpBucket,
  checkAndRecordLoginAttempt,
  clearLoginAttempts
} from '../src/middleware/auth.ts'
import type { Bindings } from '../src/index.ts'

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

test('password policy enforces 12-256 characters and validates PBKDF2 hash upgrade', async () => {
  const shortPass = 'TooShort1!'
  assert.ok(shortPass.length < 12)

  const validPass = 'ValidPassword123!'
  assert.ok(validPass.length >= 12 && validPass.length <= 256)

  const longPass = 'a'.repeat(257)
  assert.ok(longPass.length > 256)

  const hash = await hashPassword(validPass)
  assert.ok(hash.startsWith('pbkdf2_sha256$100000$'))

  const check = await verifyPassword(validPass, hash)
  assert.equal(check.matches, true)
  assert.equal(check.needsHashUpgrade, false)

  const checkWrong = await verifyPassword('WrongPassword123!', hash)
  assert.equal(checkWrong.matches, false)
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
