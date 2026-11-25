import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { Hono } from 'hono'
import realApp, { type Bindings } from '../src/index.ts'

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

function setupPhase1Db() {
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
    CREATE TABLE Services (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      best_for TEXT,
      image_url TEXT,
      image_alt TEXT,
      price INTEGER,
      duration_minutes INTEGER,
      photo_count INTEGER,
      outfits INTEGER,
      full_day INTEGER DEFAULT 0,
      currency TEXT DEFAULT 'USD',
      booking_mode TEXT DEFAULT 'direct',
      additional_people TEXT,
      display_order INTEGER DEFAULT 0,
      is_active BOOLEAN DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE Schedule_Slots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      is_booked BOOLEAN DEFAULT 0
    );
    CREATE TABLE Blocked_Dates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL UNIQUE,
      reason TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE Bookings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      service_id INTEGER,
      slot_id INTEGER,
      client_name TEXT NOT NULL,
      client_email TEXT NOT NULL,
      price_at_booking INTEGER NOT NULL,
      square_payment_id TEXT UNIQUE,
      status TEXT DEFAULT 'pending',
      customer_phone TEXT DEFAULT '',
      location TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      attendees INTEGER DEFAULT 1,
      deposit_paid INTEGER DEFAULT 0,
      coupon_code TEXT DEFAULT '',
      custom_price INTEGER,
      deposit_percent INTEGER,
      event_location TEXT,
      photo_permission_portfolio BOOLEAN DEFAULT 0,
      photo_permission_social BOOLEAN DEFAULT 0,
      photo_permission_accepted_at TEXT,
      photo_permission_version TEXT DEFAULT 'v1',
      agreement_signed_name TEXT,
      agreement_signed_at TEXT,
      applied_fees_json TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE Portfolio_Images (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      media_key TEXT NOT NULL,
      section TEXT NOT NULL DEFAULT 'gallery',
      category TEXT,
      title TEXT,
      alt_text TEXT,
      display_order INTEGER NOT NULL DEFAULT 0,
      is_featured INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1
    );
    CREATE TABLE Media_Storage (
      file_key TEXT NOT NULL,
      chunk_index INTEGER NOT NULL,
      content_type TEXT NOT NULL DEFAULT 'image/webp',
      data BLOB NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (file_key, chunk_index)
    );
  `)
  return { sqlite, db: createD1(sqlite) }
}

const VALID_SECRET = 's'.repeat(32)
const ADMIN_EMAIL = 'admin@example.com'

test('1. Shared utilities: crypto.ts, validation.ts, rateLimit.ts', async () => {
  const { timingSafeEqual } = await import('../src/utils/crypto.ts')
  assert.equal(timingSafeEqual('abc', 'abc'), true)
  assert.equal(timingSafeEqual('abc', 'abd'), false)
  assert.equal(timingSafeEqual('abc', 'abcd'), false)
  assert.equal(timingSafeEqual('', ''), true)

  const {
    safeDecodeURIComponent,
    parseJsonObject,
    isValidId,
    isRealCalendarDate,
    stripHeaderNewlines,
    validateMediaUpload
  } = await import('../src/utils/validation.ts')

  assert.equal(safeDecodeURIComponent('photos%2F1.webp'), 'photos/1.webp')
  assert.equal(safeDecodeURIComponent('%E0%A4%A'), null)

  assert.equal(isValidId('123'), true)
  assert.equal(isValidId('0'), false)
  assert.equal(isValidId('abc'), false)

  assert.equal(isRealCalendarDate('2026-02-28'), true)
  assert.equal(isRealCalendarDate('2026-02-30'), false)

  assert.equal(stripHeaderNewlines('hello\r\nX-Injected: 1\n'), 'helloX-Injected: 1')

  const validationApp = new Hono()
  validationApp.post('/json', async (c) => {
    const parsed = await parseJsonObject(c)
    if (!parsed.ok) return parsed.response
    return c.json({ ok: true, keys: Object.keys(parsed.data) })
  })

  const badJsonRes = await validationApp.request('/json', { method: 'POST', body: '{bad' })
  assert.equal(badJsonRes.status, 400)
  const arrayJsonRes = await validationApp.request('/json', { method: 'POST', body: '[1,2,3]' })
  assert.equal(arrayJsonRes.status, 400)
  const primJsonRes = await validationApp.request('/json', { method: 'POST', body: '"hello"' })
  assert.equal(primJsonRes.status, 400)
  const okJsonRes = await validationApp.request('/json', { method: 'POST', body: '{"a":1}' })
  assert.equal(okJsonRes.status, 200)

  // Magic-byte validator
  const validWebp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x10, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20])
  assert.equal(validateMediaUpload('image/webp', validWebp.buffer).ok, true)
  const htmlSpoof = new TextEncoder().encode('<html><script>alert(1)</script></html>')
  assert.equal(validateMediaUpload('image/webp', htmlSpoof.buffer).ok, false)

  // D1-backed rate limiter
  const { checkD1RateLimit } = await import('../src/middleware/rateLimit.ts')
  const { sqlite, db } = setupPhase1Db()
  assert.equal((await checkD1RateLimit(db, 'test:bucket', 2, 60)).allowed, true)
  assert.equal((await checkD1RateLimit(db, 'test:bucket', 2, 60)).allowed, true)
  const blocked = await checkD1RateLimit(db, 'test:bucket', 2, 60)
  assert.equal(blocked.allowed, false)
  assert.ok(blocked.retryAfterSeconds > 0)
  const row = sqlite.prepare('SELECT count FROM Rate_Limits WHERE bucket = ?').get('test:bucket') as { count: number }
  assert.equal(row.count, 3)

  // Fallback when db is undefined
  assert.equal((await checkD1RateLimit(undefined, 'fallback:bucket', 1, 60)).allowed, true)
  assert.equal((await checkD1RateLimit(undefined, 'fallback:bucket', 1, 60)).allowed, false)
})

test('2. Auth hardening: jti in session token, fail-closed D1 revocation/validAfter, no stale positive cache, IPv6 :: expansion, verifyAdminSessionRequest', async () => {
  const {
    createSessionToken,
    verifySessionToken,
    isTokenRevokedInDb,
    getSessionsValidAfter,
    verifyAdminSessionRequest,
    normalizeIpBucket
  } = await import('../src/middleware/auth.ts')

  // jti in token
  const t1 = await createSessionToken(VALID_SECRET, ADMIN_EMAIL)
  const t2 = await createSessionToken(VALID_SECRET, ADMIN_EMAIL)
  assert.notEqual(t1, t2, 'Two tokens issued in the same millisecond must differ via jti')
  const decodedPayload = atob(t1.split('.')[0])
  assert.equal(decodedPayload.split(':').length, 4, 'Token payload must have 4 parts including jti')
  const v1 = await verifySessionToken(t1, VALID_SECRET)
  assert.equal(v1.valid, true)
  assert.equal(v1.email, ADMIN_EMAIL)

  // Fail closed on D1 error (no swallowing)
  const brokenDb: any = {
    prepare: () => {
      throw new Error('D1_OUTAGE')
    }
  }
  await assert.rejects(() => isTokenRevokedInDb(brokenDb, t1), /D1_OUTAGE/)
  await assert.rejects(() => getSessionsValidAfter(brokenDb), /D1_OUTAGE/)

  // No 30s/60s stale positive cache: direct D1 updates take effect immediately across calls
  const { sqlite, db } = setupPhase1Db()
  assert.equal(await isTokenRevokedInDb(db, t1), false)
  const sigKey = t1.split('.')[1]
  sqlite.prepare('INSERT INTO Revoked_Sessions (signature, expires_at) VALUES (?, ?)').run(sigKey, Date.now() + 60_000)
  assert.equal(await isTokenRevokedInDb(db, t1), true, 'DB revocation must take effect immediately without 30s stale cache')

  assert.equal(await getSessionsValidAfter(db), 0)
  const futureCutoff = Date.now() + 5000
  sqlite.prepare("INSERT INTO Admin_Settings (setting_key, setting_value) VALUES ('sessions_valid_after', ?)").run(String(futureCutoff))
  assert.equal(await getSessionsValidAfter(db), futureCutoff, 'sessions_valid_after must reflect D1 immediately without 60s stale cache')

  // verifyAdminSessionRequest fails closed (503) when D1 is down
  const helperApp = new Hono<{ Bindings: Bindings }>()
  helperApp.get('/check', async (c) => {
    const res = await verifyAdminSessionRequest(c)
    if (!res.ok) return c.json({ code: res.code }, res.status)
    return c.json({ ok: true, email: res.email })
  })
  const downRes = await helperApp.request('/check', {
    headers: { Authorization: `Bearer ${t2}` }
  }, { DB: brokenDb, SESSION_SECRET: VALID_SECRET, ADMIN_EMAIL } as any)
  assert.equal(downRes.status, 503)

  // IPv6 :: compression expansion
  assert.equal(normalizeIpBucket('2001:db8:85a3::1'), 'ip:2001:0db8:85a3:0000::/64')
  assert.equal(normalizeIpBucket('2001:db8::abcd'), 'ip:2001:0db8:0000:0000::/64')
  assert.equal(normalizeIpBucket('::1'), 'ip:0000:0000:0000:0000::/64')
})

test('2b. Server-bound Google OAuth nonce endpoint & verification', async () => {
  const { db } = setupPhase1Db()
  const clientId = 'test-client.apps.googleusercontent.com'

  const pair = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify']
  )
  const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey)
  const mockJwk = { kty: jwk.kty!, alg: 'RS256', use: 'sig', kid: 'nonce-kid', n: jwk.n!, e: jwk.e! }
  const signIdToken = async (nonce: string) => {
    const nowSec = Math.floor(Date.now() / 1000)
    const h = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'nonce-kid', typ: 'JWT' })).toString('base64url')
    const p = Buffer.from(JSON.stringify({
      iss: 'https://accounts.google.com',
      aud: clientId,
      exp: nowSec + 3600,
      iat: nowSec,
      nonce,
      email: ADMIN_EMAIL,
      email_verified: true
    })).toString('base64url')
    const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(`${h}.${p}`))
    return `${h}.${p}.${Buffer.from(sig).toString('base64url')}`
  }

  const env = { DB: db, SESSION_SECRET: VALID_SECRET, ADMIN_EMAIL, GOOGLE_CLIENT_ID: clientId }
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
    // 1. GET /api/admin/auth/nonce returns nonce, no-store, and HttpOnly SameSite=Lax Path=/api/admin Max-Age=300 cookie (+ Secure on https)
    const nonceResHttp = await realApp.fetch(new Request('http://localhost/api/admin/auth/nonce'), env)
    assert.equal(nonceResHttp.status, 200)
    assert.equal(nonceResHttp.headers.get('Cache-Control'), 'no-store')
    const setCookieHttp = nonceResHttp.headers.get('Set-Cookie') || ''
    assert.match(setCookieHttp, /HttpOnly/i)
    assert.match(setCookieHttp, /SameSite=Lax/i)
    assert.match(setCookieHttp, /Path=\/api\/admin/i)
    assert.match(setCookieHttp, /Max-Age=300/i)
    assert.ok(!/;\s*Secure/i.test(setCookieHttp), 'HTTP request must not set Secure flag')
    const { nonce } = (await nonceResHttp.json()) as { nonce: string }
    assert.ok(nonce && nonce.length >= 16)

    const nonceResHttps = await realApp.fetch(new Request('https://r59media.com/api/admin/auth/nonce'), env)
    assert.equal(nonceResHttps.status, 200)
    assert.match(nonceResHttps.headers.get('Set-Cookie') || '', /;\s*Secure/i)

    const cookiePair = setCookieHttp.split(';')[0]
    const idToken = await signIdToken(nonce)

    // 2. Missing cookie on POST /api/admin/google-login -> rejected (401)
    const missingCookieRes = await realApp.fetch(
      new Request('http://localhost/api/admin/google-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '198.51.100.51' },
        body: JSON.stringify({ idToken, nonce })
      }),
      env
    )
    assert.equal(missingCookieRes.status, 401)
    assert.equal(missingCookieRes.headers.get('Cache-Control'), 'no-store')

    // 3. Tampered cookie -> rejected (401)
    const tamperedCookieRes = await realApp.fetch(
      new Request('http://localhost/api/admin/google-login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'CF-Connecting-IP': '198.51.100.52',
          Cookie: `${cookiePair}tampered`
        },
        body: JSON.stringify({ idToken, nonce })
      }),
      env
    )
    assert.equal(tamperedCookieRes.status, 401)

    // 4. Valid cookie + matching nonce -> 200 and no-store
    const okRes = await realApp.fetch(
      new Request('http://localhost/api/admin/google-login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'CF-Connecting-IP': '198.51.100.53',
          Cookie: cookiePair
        },
        body: JSON.stringify({ idToken, nonce })
      }),
      env
    )
    assert.equal(okRes.status, 200)
    assert.equal(okRes.headers.get('Cache-Control'), 'no-store')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('3. Media upload XSS prevention, safe decoding, 503 on D1 error, X-R59-Client bypass removal, CSP, _headers', async () => {
  const { createSessionToken } = await import('../src/middleware/auth.ts')
  const { sqlite, db } = setupPhase1Db()
  const env: Bindings = {
    DB: db,
    SESSION_SECRET: VALID_SECRET,
    ADMIN_EMAIL,
    ASSETS: {
      fetch: async (req: Request) => new Response(`ASSET:${new URL(req.url).pathname}`, { status: 200 })
    } as any
  }
  const adminToken = await createSessionToken(VALID_SECRET, ADMIN_EMAIL)

  // 1. Both PUT /api/media/* and PUT /api/admin/media/* reject HTML payload disguised as image/webp
  const htmlBytes = Buffer.from('<html><script>alert(1)</script></html>')
  for (const endpoint of ['/api/media/evil.webp', '/api/admin/media/evil.webp']) {
    const res = await realApp.fetch(
      new Request(`http://localhost${endpoint}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'image/webp', Authorization: `Bearer ${adminToken}` },
        body: htmlBytes
      }),
      env
    )
    assert.equal(res.status, 400, `${endpoint} must reject non-image magic bytes`)
  }

  // Valid PNG succeeds on both
  const validPng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
  const okPut = await realApp.fetch(
    new Request('http://localhost/api/admin/media/ok.png', {
      method: 'PUT',
      headers: { 'Content-Type': 'image/png', Authorization: `Bearer ${adminToken}` },
      body: validPng
    }),
    env
  )
  assert.equal(okPut.status, 200)

  // 2. mediaGetHandler forces octet-stream + attachment for non-allowlisted MIME (e.g., text/html)
  sqlite.prepare('INSERT INTO Media_Storage (file_key, chunk_index, content_type, data) VALUES (?, ?, ?, ?)').run(
    'legacy-xss.html', 0, 'text/html', htmlBytes
  )
  const xssRes = await realApp.fetch(
    new Request('http://localhost/api/media/legacy-xss.html', {
      headers: { Authorization: `Bearer ${adminToken}` }
    }),
    env
  )
  assert.equal(xssRes.status, 200)
  assert.equal(xssRes.headers.get('Content-Type'), 'application/octet-stream')
  assert.equal(xssRes.headers.get('Content-Disposition'), 'attachment')
  assert.equal(xssRes.headers.get('X-Content-Type-Options'), 'nosniff')

  // 3. Malformed % encoding returns 400 (never 500)
  const badPercentGet = await realApp.fetch(new Request('http://localhost/api/media/%E0%A4%A'), env)
  assert.equal(badPercentGet.status, 400)
  const badPercentPut = await realApp.fetch(
    new Request('http://localhost/api/admin/media/%E0%A4%A', {
      method: 'PUT',
      headers: { 'Content-Type': 'image/png', Authorization: `Bearer ${adminToken}` },
      body: validPng
    }),
    env
  )
  assert.equal(badPercentPut.status, 400)

  // 4. D1 operational error in mediaGetHandler returns 503 (not 404)
  const { signMediaKey } = await import('../src/utils/signedUrl.ts')
  const { getMediaSigningSecret } = await import('../src/middleware/auth.ts')
  const mediaSecret = await getMediaSigningSecret(env)
  const { exp, sig } = await signMediaKey('any.webp', mediaSecret!, 60)
  const brokenDbEnv = {
    ...env,
    DB: { prepare: () => { throw new Error('D1_DOWN') } } as any
  }
  const dbErrRes = await realApp.fetch(
    new Request(`http://localhost/api/media/any.webp?exp=${exp}&sig=${sig}`),
    brokenDbEnv
  )
  assert.equal(dbErrRes.status, 503)

  // 5. Spoofed X-R59-Client: media-viewer alone (without Sec-Fetch-Site: same-origin or same-origin Referer) does NOT bypass /assets/*.webp
  const spoofedRes = await realApp.fetch(
    new Request('http://localhost/assets/secret-build.webp', {
      headers: { 'X-R59-Client': 'media-viewer' }
    }),
    env
  )
  assert.equal(spoofedRes.status, 302)

  // 6. CSP script-src restricts cdn.jsdelivr.net to exact heic2any script URL
  const cspRes = await realApp.fetch(new Request('http://localhost/api/health'), env)
  const csp = cspRes.headers.get('Content-Security-Policy') || ''
  assert.ok(!/https:\/\/cdn\.jsdelivr\.net(?=[;\s])/.test(csp), 'CSP must not allow wildcard origin https://cdn.jsdelivr.net')
  assert.ok(csp.includes('https://cdn.jsdelivr.net/npm/heic2any@0.0.4/dist/heic2any.min.js'))

  // 7. _headers has baseline security headers under /*
  const builtHeadersPath = resolve(import.meta.dirname, '../public/_headers')
  const sourceHeadersPath = resolve(import.meta.dirname, '../../frontend/public/_headers')
  const headersPath = existsSync(builtHeadersPath) ? builtHeadersPath : sourceHeadersPath
  const headersFile = readFileSync(headersPath, 'utf8')
  assert.match(headersFile, /^\/\*\s*$/m)
  assert.match(headersFile, /X-Content-Type-Options:\s*nosniff/)
  assert.match(headersFile, /X-Frame-Options:\s*DENY/)
  assert.match(headersFile, /Referrer-Policy:\s*strict-origin-when-cross-origin/)
})

test('4. Services auth & active-filter hardening', async () => {
  const { createSessionToken } = await import('../src/middleware/auth.ts')
  const { sqlite, db } = setupPhase1Db()
  const env: Bindings = { DB: db, SESSION_SECRET: VALID_SECRET, ADMIN_EMAIL }

  sqlite.prepare("INSERT INTO Services (id, name, price, is_active) VALUES (1, 'Active Pkg', 10000, 1)").run()
  sqlite.prepare("INSERT INTO Services (id, name, price, is_active) VALUES (2, 'Hidden Pkg', 20000, 0)").run()

  // Wrong email token must NOT unlock ?all=true or inactive /:id
  const wrongEmailToken = await createSessionToken(VALID_SECRET, 'intruder@example.com')
  const listWrong = await realApp.fetch(
    new Request('http://localhost/api/services?all=true', {
      headers: { Authorization: `Bearer ${wrongEmailToken}` }
    }),
    env
  )
  assert.equal(listWrong.status, 200)
  const listWrongJson = (await listWrong.json()) as { services: Array<{ id: string }> }
  assert.deepEqual(listWrongJson.services.map(s => s.id), ['1'])

  // Unauthenticated GET /api/services/2 -> 404
  const getHiddenUnauth = await realApp.fetch(new Request('http://localhost/api/services/2'), env)
  assert.equal(getHiddenUnauth.status, 404)

  // Wrong-email GET /api/services/2 -> 404
  const getHiddenWrong = await realApp.fetch(
    new Request('http://localhost/api/services/2', {
      headers: { Authorization: `Bearer ${wrongEmailToken}` }
    }),
    env
  )
  assert.equal(getHiddenWrong.status, 404)

  // Valid admin GET /api/services/2 -> 200 + Cache-Control: private, no-store
  const adminToken = await createSessionToken(VALID_SECRET, ADMIN_EMAIL)
  const getHiddenAdmin = await realApp.fetch(
    new Request('http://localhost/api/services/2', {
      headers: { Authorization: `Bearer ${adminToken}` }
    }),
    env
  )
  assert.equal(getHiddenAdmin.status, 200)
  assert.equal(getHiddenAdmin.headers.get('Cache-Control'), 'private, no-store')

  // Valid admin GET /api/services?all=true -> includes both 1 and 2
  const listAdmin = await realApp.fetch(
    new Request('http://localhost/api/services?all=true', {
      headers: { Authorization: `Bearer ${adminToken}` }
    }),
    env
  )
  assert.equal(listAdmin.status, 200)
  const listAdminJson = (await listAdmin.json()) as { services: Array<{ id: string }> }
  assert.deepEqual(listAdminJson.services.map(s => s.id), ['1', '2'])
})

test('5. Reschedule & calendar feed token security: D1 rate limit, exp, version rotation, cancelled ICS, 90-day bound, no-store', async () => {
  const { createSessionToken } = await import('../src/middleware/auth.ts')
  const { signRescheduleToken, verifyRescheduleToken, signCalendarFeedToken, verifyCalendarFeedToken } = await import('../src/utils/signedUrl.ts')

  // Expiring reschedule token
  const expiredTok = await signRescheduleToken(10, 'client@example.com', VALID_SECRET, {
    expSeconds: Math.floor(Date.now() / 1000) - 60
  })
  assert.equal(await verifyRescheduleToken(10, 'client@example.com', expiredTok, VALID_SECRET), false)

  const futureTok = await signRescheduleToken(10, 'client@example.com', VALID_SECRET, {
    eventDate: '2030-06-15'
  })
  assert.equal(await verifyRescheduleToken(10, 'client@example.com', futureTok, VALID_SECRET), true)

  // Versioned calendar feed token
  const feedV1 = await signCalendarFeedToken(VALID_SECRET, '1')
  assert.equal(await verifyCalendarFeedToken(feedV1, VALID_SECRET, '1'), true)
  assert.equal(await verifyCalendarFeedToken(feedV1, VALID_SECRET, '2'), false)

  const { sqlite, db } = setupPhase1Db()
  const env: Bindings = { DB: db, SESSION_SECRET: VALID_SECRET, ADMIN_EMAIL }
  const adminToken = await createSessionToken(VALID_SECRET, ADMIN_EMAIL)

  const today = new Date().toISOString().slice(0, 10)
  const oldDate = '2020-01-01'
  const recentDate = today

  sqlite.prepare("INSERT INTO Services (id, name, price, duration_minutes) VALUES (1, 'Portrait', 10000, 60)").run()
  sqlite.prepare("INSERT INTO Schedule_Slots (id, date, start_time, end_time, is_booked) VALUES (1, ?, '10:00', '11:00', 1)").run(oldDate)
  sqlite.prepare("INSERT INTO Schedule_Slots (id, date, start_time, end_time, is_booked) VALUES (2, ?, '12:00', '13:00', 1)").run(recentDate)
  sqlite.prepare("INSERT INTO Schedule_Slots (id, date, start_time, end_time, is_booked) VALUES (3, ?, '14:00', '15:00', 0)").run(recentDate)

  sqlite.prepare("INSERT INTO Bookings (id, service_id, slot_id, client_name, client_email, price_at_booking, status) VALUES (1, 1, 1, 'Old Client', 'old@example.com', 10000, 'confirmed')").run()
  sqlite.prepare("INSERT INTO Bookings (id, service_id, slot_id, client_name, client_email, price_at_booking, status) VALUES (2, 1, 2, 'Recent Client', 'recent@example.com', 10000, 'confirmed')").run()
  sqlite.prepare("INSERT INTO Bookings (id, service_id, slot_id, client_name, client_email, price_at_booking, status) VALUES (3, 1, 3, 'Cancelled Client', 'cancel@example.com', 10000, 'cancelled')").run()

  // Cancelled booking ICS rejected
  const cancelTok = await signRescheduleToken(3, 'cancel@example.com', VALID_SECRET)
  const cancelIcsRes = await realApp.fetch(
    new Request(`http://localhost/api/bookings/3/calendar.ics?token=${encodeURIComponent(cancelTok)}`),
    env
  )
  assert.ok(cancelIcsRes.status >= 400 && cancelIcsRes.status < 500, 'Cancelled booking ICS must be rejected')
  assert.equal(cancelIcsRes.headers.get('Cache-Control'), 'no-store')

  // Studio calendar feed bounds out bookings older than today - 90 days
  const feedRes1 = await realApp.fetch(
    new Request('http://localhost/api/admin/calendar-feed', {
      headers: { Authorization: `Bearer ${adminToken}` }
    }),
    env
  )
  assert.equal(feedRes1.status, 200)
  const { icsFeedUrl } = (await feedRes1.json()) as { icsFeedUrl: string }
  const icsRes = await realApp.fetch(new Request(icsFeedUrl), env)
  assert.equal(icsRes.status, 200)
  assert.equal(icsRes.headers.get('Cache-Control'), 'no-store')
  const icsBody = await icsRes.text()
  assert.ok(icsBody.includes('UID:booking-2@r59media'), 'Recent booking must be in feed')
  assert.ok(!icsBody.includes('UID:booking-1@r59media'), 'Booking > 90 days old must be excluded from feed')

  // Rotate calendar feed version invalidates old URL
  const rotateRes = await realApp.fetch(
    new Request('http://localhost/api/admin/calendar-feed/rotate', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` }
    }),
    env
  )
  assert.equal(rotateRes.status, 200)
  const rotatedJson = (await rotateRes.json()) as { icsFeedUrl: string }
  assert.notEqual(rotatedJson.icsFeedUrl, icsFeedUrl)

  const oldFeedAttempt = await realApp.fetch(new Request(icsFeedUrl), env)
  assert.equal(oldFeedAttempt.status, 401, 'Old calendar feed URL must be rejected after rotation')
  assert.equal(oldFeedAttempt.headers.get('Cache-Control'), 'no-store')

  const newFeedAttempt = await realApp.fetch(new Request(rotatedJson.icsFeedUrl), env)
  assert.equal(newFeedAttempt.status, 200)

  // Reschedule unlock uses D1 Rate_Limits table and sets Cache-Control: no-store
  const unlockRes = await realApp.fetch(
    new Request('http://localhost/api/bookings/reschedule/unlock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.9' },
      body: JSON.stringify({ name: 'Nobody', email: 'nobody@example.com' })
    }),
    env
  )
  assert.equal(unlockRes.status, 404)
  assert.equal(unlockRes.headers.get('Cache-Control'), 'no-store')
  const rateRows = sqlite.prepare('SELECT bucket, count FROM Rate_Limits').all() as Array<{ bucket: string; count: number }>
  assert.ok(rateRows.length >= 1 && rateRows[0].count === 1, 'Reschedule unlock must record rate limit in D1 Rate_Limits')
})
