import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import workerEntry, { app as realApp, type Bindings } from '../src/index.ts'
import { clearLoginAttempts, createSessionToken, revokeTokenInDb } from '../src/middleware/auth.ts'
import { BOOKING_PAYMENTS_TABLE_SQL, BILLING_SCHEMA_STEPS } from '../src/lib/billingSchema.ts'

function createD1(sqlite: DatabaseSync): any {
  const plain = (row: any) => (row ? { ...row } : null)
  const makeStmt = (sql: string, params: any[] = []): any => ({
    sql,
    bind: (...values: any[]) => makeStmt(sql, values),
    first: async (col?: string) => {
      const row = plain(sqlite.prepare(sql).get(...params))
      return row && col ? row[col] : row
    },
    all: async () => ({ success: true, results: sqlite.prepare(sql).all(...params).map(plain), meta: {} }),
    run: async () => {
      const info = sqlite.prepare(sql).run(...params)
      return { success: true, results: [], meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) } }
    }
  })
  return {
    prepare: (sql: string) => makeStmt(sql),
    exec: async (sql: string) => sqlite.exec(sql),
    batch: async (statements: any[]) => {
      sqlite.exec('BEGIN')
      try {
        const out = []
        for (const s of statements) out.push(/^\s*(SELECT|PRAGMA)/i.test(s.sql) ? await s.all() : await s.run())
        sqlite.exec('COMMIT')
        return out
      } catch (err) {
        sqlite.exec('ROLLBACK')
        throw err
      }
    }
  }
}

function getFutureDate(daysAhead: number): string {
  return new Date(Date.now() + daysAhead * 86400_000).toISOString().slice(0, 10)
}

function setupAdminDb() {
  const sqlite = new DatabaseSync(':memory:')
  sqlite.exec(`
    CREATE TABLE Admin_Settings (setting_key TEXT PRIMARY KEY, setting_value TEXT NOT NULL);
    CREATE TABLE Login_Attempts (bucket TEXT PRIMARY KEY, attempts INTEGER NOT NULL, window_start INTEGER NOT NULL);
    CREATE TABLE Revoked_Sessions (signature TEXT PRIMARY KEY, expires_at INTEGER NOT NULL);
    CREATE TABLE Rate_Limits (bucket TEXT PRIMARY KEY, count INTEGER NOT NULL, window_start INTEGER NOT NULL);
    CREATE TABLE Blocked_Dates (id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT NOT NULL UNIQUE, reason TEXT);
    CREATE TABLE Services (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      best_for TEXT,
      image_url TEXT,
      image_alt TEXT,
      price INTEGER,
      duration_minutes INTEGER DEFAULT 60,
      photo_count INTEGER,
      outfits INTEGER,
      full_day INTEGER DEFAULT 0,
      currency TEXT DEFAULT 'USD',
      booking_mode TEXT DEFAULT 'direct',
      additional_people TEXT,
      display_order INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE Schedule_Slots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      is_booked INTEGER DEFAULT 0
    );
    CREATE TABLE Bookings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      service_id INTEGER,
      slot_id INTEGER,
      client_name TEXT NOT NULL,
      client_email TEXT NOT NULL,
      price_at_booking INTEGER NOT NULL,
      square_payment_id TEXT UNIQUE,
      status TEXT DEFAULT 'confirmed',
      customer_phone TEXT DEFAULT '',
      location TEXT DEFAULT '',
      event_location TEXT,
      notes TEXT DEFAULT '',
      attendees INTEGER DEFAULT 1,
      deposit_paid INTEGER DEFAULT 0,
      coupon_code TEXT DEFAULT '',
      custom_price INTEGER,
      deposit_percent INTEGER,
      photo_permission_portfolio BOOLEAN DEFAULT 0,
      photo_permission_social BOOLEAN DEFAULT 0,
      photo_permission_accepted_at TEXT,
      photo_permission_version TEXT DEFAULT 'v1',
      locked_slot_ids_json TEXT,
      gcal_sync_status TEXT,
      reschedule_count INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE Coupons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      discount_type TEXT NOT NULL,
      discount_value REAL NOT NULL,
      description TEXT DEFAULT '',
      expires_at TEXT,
      max_uses INTEGER,
      used_count INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1
    );
    CREATE TABLE Portfolio_Images (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      media_key TEXT NOT NULL,
      section TEXT NOT NULL DEFAULT 'gallery',
      category TEXT NOT NULL DEFAULT 'Portrait',
      title TEXT,
      alt_text TEXT,
      display_order INTEGER NOT NULL DEFAULT 0,
      is_featured INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1
    );
    CREATE TABLE Leads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT,
      session_type TEXT,
      message TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE Media_Storage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_key TEXT NOT NULL,
      chunk_index INTEGER NOT NULL DEFAULT 0,
      content_type TEXT NOT NULL,
      data BLOB NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(file_key, chunk_index)
    );
  `)
  sqlite.exec(BOOKING_PAYMENTS_TABLE_SQL)
  for (const step of BILLING_SCHEMA_STEPS) {
    try {
      sqlite.exec(step.sql)
    } catch (err) {
      if (!step.ignoreError) throw err
    }
  }
  sqlite.exec("INSERT INTO Admin_Settings (setting_key, setting_value) VALUES ('timezone', 'America/New_York')")

  const env: Bindings = {
    DB: createD1(sqlite),
    SESSION_SECRET: 'a'.repeat(32),
    ADMIN_EMAIL: 'admin@r59media.com',
    GOOGLE_CLIENT_ID: 'google-cid.apps.googleusercontent.com',
    ALLOWED_ORIGINS: 'https://r59media.com,https://admin.r59media.com',
    SQUARE_ACCESS_TOKEN: 'sq-tok',
    SQUARE_LOCATION_ID: 'LOC_1',
    SQUARE_ENVIRONMENT: 'sandbox',
    RESEND_API_KEY: 're_test',
    EMAIL_FROM: 'ops@r59media.com'
  }
  return { sqlite, env }
}

async function createGoogleJwt(claims: Record<string, unknown>, kid = 'admin-route-kid') {
  const pair = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify']
  )
  const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey)
  const mockJwk = { kty: jwk.kty!, alg: 'RS256', use: 'sig', kid, n: jwk.n!, e: jwk.e! }
  const h = Buffer.from(JSON.stringify({ alg: 'RS256', kid, typ: 'JWT' })).toString('base64url')
  const p = Buffer.from(JSON.stringify(claims)).toString('base64url')
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(`${h}.${p}`))
  return { idToken: `${h}.${p}.${Buffer.from(sig).toString('base64url')}`, mockJwk }
}

test('Google auth nonce cookie binding, invalid/missing cookie (401), brute-force lockout (429), and Cache-Control: no-store', async () => {
  const { env } = setupAdminDb()
  const nowSec = Math.floor(Date.now() / 1000)

  const nonceRes = await realApp.fetch(new Request('http://localhost/api/admin/auth/nonce'), env)
  assert.equal(nonceRes.status, 200)
  assert.equal(nonceRes.headers.get('Cache-Control'), 'no-store')
  const { nonce } = (await nonceRes.json()) as { nonce: string }
  const cookie = (nonceRes.headers.get('Set-Cookie') || '').split(';')[0]
  assert.ok(cookie.startsWith('r59_oauth_nonce='))

  const { idToken, mockJwk } = await createGoogleJwt({
    iss: 'https://accounts.google.com',
    aud: env.GOOGLE_CLIENT_ID,
    exp: nowSec + 3600,
    iat: nowSec,
    nonce,
    email: env.ADMIN_EMAIL,
    email_verified: true
  })

  const origFetch = globalThis.fetch
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    if (String(input).includes('googleapis.com/oauth2/v3/certs')) {
      return new Response(JSON.stringify({ keys: [mockJwk] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    }
    return new Response('{}', { status: 404 })
  }) as typeof fetch

  try {
    // Missing cookie -> 401 + no-store
    const noCookie = await realApp.fetch(
      new Request('http://localhost/api/admin/google-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': '198.51.100.200' },
        body: JSON.stringify({ idToken, nonce })
      }),
      env
    )
    assert.equal(noCookie.status, 401)
    assert.equal(noCookie.headers.get('Cache-Control'), 'no-store')

    // Invalid cookie -> 401
    const badCookie = await realApp.fetch(
      new Request('http://localhost/api/admin/google-login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'cf-connecting-ip': '198.51.100.200',
          Cookie: 'r59_oauth_nonce=tampered.9999999999999.0000'
        },
        body: JSON.stringify({ idToken, nonce })
      }),
      env
    )
    assert.equal(badCookie.status, 401)

    // Brute-force lockout after 5 attempts from same IP -> 429 on 6th
    for (let i = 0; i < 3; i++) {
      await realApp.fetch(
        new Request('http://localhost/api/admin/google-login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': '198.51.100.200' },
          body: JSON.stringify({ idToken, nonce })
        }),
        env
      )
    }
    const locked = await realApp.fetch(
      new Request('http://localhost/api/admin/google-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': '198.51.100.200', Cookie: cookie },
        body: JSON.stringify({ idToken, nonce })
      }),
      env
    )
    assert.equal(locked.status, 429)
    assert.equal(locked.headers.get('Cache-Control'), 'no-store')
    assert.ok(Number(locked.headers.get('Retry-After')) >= 1)

    // Valid cookie from fresh IP -> 200
    const okRes = await realApp.fetch(
      new Request('http://localhost/api/admin/google-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': '198.51.100.201', Cookie: cookie },
        body: JSON.stringify({ idToken, nonce })
      }),
      env
    )
    assert.equal(okRes.status, 200)
    assert.equal(okRes.headers.get('Cache-Control'), 'no-store')
    assert.ok(((await okRes.json()) as any).token)
  } finally {
    globalThis.fetch = origFetch
    await clearLoginAttempts(env.DB, '198.51.100.200')
    await clearLoginAttempts(env.DB, '198.51.100.201')
  }
})

test('Services auth (?all=true, /:id), shared validation on POST/PUT/DELETE /api/services & /api/admin/packages/:id, and old media cleanup', async () => {
  const { sqlite, env } = setupAdminDb()
  sqlite.prepare("INSERT INTO Services (id, name, price, image_url, is_active) VALUES (1, 'Active', 10000, '/api/media/svc-old.webp', 1)").run()
  sqlite.prepare("INSERT INTO Services (id, name, price, is_active) VALUES (2, 'Inactive', 15000, 0)").run()
  sqlite.prepare("INSERT INTO Media_Storage (file_key, chunk_index, content_type, data) VALUES ('svc-old.webp', 0, 'image/webp', ?)").run(
    Buffer.from('OLD')
  )

  const adminToken = await createSessionToken(env.SESSION_SECRET!, env.ADMIN_EMAIL!)

  // Stale sessions_valid_after -> rejected on ?all=true (returns only active) and /:id (404)
  await env.DB.prepare("INSERT INTO Admin_Settings (setting_key, setting_value) VALUES ('sessions_valid_after', ?)").bind(String(Date.now() + 5000)).run()
  const staleList = await realApp.fetch(
    new Request('http://localhost/api/services?all=true', { headers: { Authorization: `Bearer ${adminToken}` } }),
    env
  )
  assert.deepEqual(((await staleList.json()) as any).services.map((s: any) => s.id), ['1'])
  const staleDetail = await realApp.fetch(
    new Request('http://localhost/api/services/2', { headers: { Authorization: `Bearer ${adminToken}` } }),
    env
  )
  assert.equal(staleDetail.status, 404)

  // Reset validAfter -> revoked token also rejected; fresh valid token succeeds
  await env.DB.prepare("UPDATE Admin_Settings SET setting_value = '0' WHERE setting_key = 'sessions_valid_after'").run()
  const revokedTok = await createSessionToken(env.SESSION_SECRET!, env.ADMIN_EMAIL!)
  await revokeTokenInDb(env.DB, revokedTok)
  const revokedList = await realApp.fetch(
    new Request('http://localhost/api/services?all=true', { headers: { Authorization: `Bearer ${revokedTok}` } }),
    env
  )
  assert.deepEqual(((await revokedList.json()) as any).services.map((s: any) => s.id), ['1'])

  const okList = await realApp.fetch(
    new Request('http://localhost/api/services?all=true', { headers: { Authorization: `Bearer ${adminToken}` } }),
    env
  )
  assert.deepEqual(((await okList.json()) as any).services.map((s: any) => s.id), ['1', '2'])

  const okInactive = await realApp.fetch(
    new Request('http://localhost/api/services/2', { headers: { Authorization: `Bearer ${adminToken}` } }),
    env
  )
  assert.equal(okInactive.status, 200)
  assert.equal(okInactive.headers.get('Cache-Control'), 'private, no-store')

  // POST /api/services validation & creation
  const badCreate = await realApp.fetch(
    new Request('http://localhost/api/services', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ name: '', booking_mode: 'invalid_mode' })
    }),
    env
  )
  assert.equal(badCreate.status, 400)

  const created = await realApp.fetch(
    new Request('http://localhost/api/services', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ name: 'Wedding', price: 90000, image_url: '/api/media/svc-new.webp' })
    }),
    env
  )
  assert.equal(created.status, 200)
  const createdId = ((await created.json()) as any).id

  // PUT /api/admin/packages/1 replaces image_url -> deletes unreferenced svc-old.webp from Media_Storage
  const pkgUpdate = await realApp.fetch(
    new Request('http://localhost/api/admin/packages/1', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ image_url: '/api/media/svc-replacement.webp' })
    }),
    env
  )
  assert.equal(pkgUpdate.status, 200)
  assert.equal((sqlite.prepare("SELECT COUNT(*) AS cnt FROM Media_Storage WHERE file_key = 'svc-old.webp'").get() as any).cnt, 0)

  // PUT /api/services/:id & DELETE /api/services/:id
  const putSvc = await realApp.fetch(
    new Request(`http://localhost/api/services/${createdId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ name: 'Wedding Deluxe', price: 95000 })
    }),
    env
  )
  assert.equal(putSvc.status, 200)

  const delSvc = await realApp.fetch(
    new Request(`http://localhost/api/services/${createdId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` }
    }),
    env
  )
  assert.equal(delSvc.status, 200)
})

test('GET /api/coupons/validate handles valid, expired, maxed-out, inactive, and 429 rate limit', async () => {
  const { sqlite, env } = setupAdminDb()
  sqlite.prepare("INSERT INTO Coupons (code, discount_type, discount_value, is_active, expires_at, max_uses, used_count) VALUES ('GOOD20', 'percent', 20, 1, '2099-12-31', 5, 1)").run()
  sqlite.prepare("INSERT INTO Coupons (code, discount_type, discount_value, is_active, expires_at) VALUES ('EXP', 'fixed', 10, 1, '2020-01-01')").run()
  sqlite.prepare("INSERT INTO Coupons (code, discount_type, discount_value, is_active, max_uses, used_count) VALUES ('MAX', 'fixed', 10, 1, 2, 2)").run()
  sqlite.prepare("INSERT INTO Coupons (code, discount_type, discount_value, is_active) VALUES ('OFF', 'fixed', 10, 0)").run()

  const check = async (code: string, ip = '203.0.113.80') =>
    (await (await realApp.fetch(new Request(`http://localhost/api/coupons/validate?code=${encodeURIComponent(code)}`, { headers: { 'cf-connecting-ip': ip } }), env)).json()) as any

  assert.equal((await check('good20')).valid, true)
  assert.equal((await check('EXP')).valid, false)
  assert.equal((await check('MAX')).valid, false)
  assert.equal((await check('OFF')).valid, false)

  // 429 after 30 requests/min
  for (let i = 0; i < 30; i++) {
    const r = await realApp.fetch(
      new Request('http://localhost/api/coupons/validate?code=GOOD20', { headers: { 'cf-connecting-ip': '203.0.113.81' } }),
      env
    )
    assert.equal(r.status, 200)
  }
  const r429 = await realApp.fetch(
    new Request('http://localhost/api/coupons/validate?code=GOOD20', { headers: { 'cf-connecting-ip': '203.0.113.81' } }),
    env
  )
  assert.equal(r429.status, 429)
})

test('Admin bookings: POST multi-slot + blocked date, PUT invalid date 2026-02-31 + multi-slot reassignment, PATCH /cancel blocks open invoice BEFORE Square refund', async () => {
  const { sqlite, env } = setupAdminDb()
  const adminToken = await createSessionToken(env.SESSION_SECRET!, env.ADMIN_EMAIL!)
  const d1 = getFutureDate(14)
  const d2 = getFutureDate(15)
  const blockedDate = getFutureDate(16)

  sqlite.prepare("INSERT INTO Services (id, name, price, duration_minutes, is_active) VALUES (1, '2h Shoot', 30000, 120, 1)").run()
  sqlite.prepare('INSERT INTO Blocked_Dates (date, reason) VALUES (?, ?)').run(blockedDate, 'Holiday')
  sqlite.prepare("INSERT INTO Schedule_Slots (id, date, start_time, end_time, is_booked) VALUES (1, ?, '10:00', '11:00', 0)").run(d1)
  sqlite.prepare("INSERT INTO Schedule_Slots (id, date, start_time, end_time, is_booked) VALUES (2, ?, '11:00', '12:00', 0)").run(d1)
  sqlite.prepare("INSERT INTO Schedule_Slots (id, date, start_time, end_time, is_booked) VALUES (3, ?, '13:00', '14:00', 0)").run(d2)
  sqlite.prepare("INSERT INTO Schedule_Slots (id, date, start_time, end_time, is_booked) VALUES (4, ?, '14:00', '15:00', 0)").run(d2)
  sqlite.prepare("INSERT INTO Schedule_Slots (id, date, start_time, end_time, is_booked) VALUES (5, ?, '10:00', '11:00', 0)").run(blockedDate)

  // Blocked date rejected on POST /api/admin/bookings (both by date -> BLOCKED_DATE and by slot_id -> 409)
  const blockedByDateRes = await realApp.fetch(
    new Request('http://localhost/api/admin/bookings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ client_name: 'Bob', client_email: 'bob@example.com', service_id: 1, date: blockedDate, start_time: '10:00', end_time: '11:00' })
    }),
    env
  )
  assert.equal(blockedByDateRes.status, 409)
  assert.equal(((await blockedByDateRes.json()) as any).error.code, 'BLOCKED_DATE')

  const blockedRes = await realApp.fetch(
    new Request('http://localhost/api/admin/bookings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ client_name: 'Bob', client_email: 'bob@example.com', service_id: 1, slot_id: 5 })
    }),
    env
  )
  assert.equal(blockedRes.status, 409)
  assert.equal(((await blockedRes.json()) as any).error.code, 'SLOT_ALREADY_BOOKED')

  // Multi-slot POST /api/admin/bookings locks slots 1 & 2
  const postRes = await realApp.fetch(
    new Request('http://localhost/api/admin/bookings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ client_name: 'Bob', client_email: 'bob@example.com', service_id: 1, slot_id: 1 })
    }),
    env
  )
  assert.equal(postRes.status, 200)
  const bookingId = ((await postRes.json()) as any).id
  assert.equal((sqlite.prepare('SELECT is_booked FROM Schedule_Slots WHERE id = 1').get() as any).is_booked, 1)
  assert.equal((sqlite.prepare('SELECT is_booked FROM Schedule_Slots WHERE id = 2').get() as any).is_booked, 1)

  // PUT invalid calendar date 2026-02-31 -> 400
  const badDateRes = await realApp.fetch(
    new Request(`http://localhost/api/admin/bookings/${bookingId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ date: '2026-02-31' })
    }),
    env
  )
  assert.equal(badDateRes.status, 400)

  // PATCH multi-slot reassignment to slot 3 (locks 3 & 4, releases 1 & 2)
  const moveRes = await realApp.fetch(
    new Request(`http://localhost/api/admin/bookings/${bookingId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ slot_id: 3 })
    }),
    env
  )
  assert.equal(moveRes.status, 200)
  assert.equal((sqlite.prepare('SELECT is_booked FROM Schedule_Slots WHERE id = 1').get() as any).is_booked, 0)
  assert.equal((sqlite.prepare('SELECT is_booked FROM Schedule_Slots WHERE id = 2').get() as any).is_booked, 0)
  assert.equal((sqlite.prepare('SELECT is_booked FROM Schedule_Slots WHERE id = 3').get() as any).is_booked, 1)
  assert.equal((sqlite.prepare('SELECT is_booked FROM Schedule_Slots WHERE id = 4').get() as any).is_booked, 1)

  // PATCH /cancel blocks when open invoice exists (PAID in Square -> INVOICE_ALREADY_PAID) BEFORE calling Square refund!
  sqlite.prepare("UPDATE Bookings SET square_payment_id = 'pay_dep_1', deposit_paid = 10000 WHERE id = ?").run(bookingId)
  sqlite.prepare(
    "INSERT INTO Booking_Invoices (booking_id, attempt_key, square_invoice_id, version, amount_cents, status) VALUES (?, 'att_c_1', 'inv_c_1', 1, 20000, 'UNPAID')"
  ).run(bookingId)

  const origFetch = globalThis.fetch
  let refundCalled = false
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/v2/invoices/inv_c_1')) {
      return new Response(
        JSON.stringify({
          invoice: {
            id: 'inv_c_1',
            version: 2,
            status: 'PAID',
            payment_requests: [{ total_completed_amount_money: { amount: 20000, currency: 'USD' } }]
          }
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    }
    if (url.includes('/v2/refunds')) {
      refundCalled = true
      return new Response(JSON.stringify({ refund: { id: 'ref_should_not_happen' } }), { status: 200 })
    }
    return new Response('{}', { status: 404 })
  }) as typeof fetch

  try {
    const cancelBlocked = await realApp.fetch(
      new Request(`http://localhost/api/admin/bookings/${bookingId}/cancel`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ refund: true })
      }),
      env
    )
    assert.equal(cancelBlocked.status, 409)
    assert.equal(((await cancelBlocked.json()) as any).error.code, 'INVOICE_ALREADY_PAID')
    assert.equal(refundCalled, false, 'Square refund must NEVER be called when open invoice cancel fails')
    assert.equal((sqlite.prepare('SELECT status FROM Bookings WHERE id = ?').get(bookingId) as any).status, 'confirmed')
  } finally {
    globalThis.fetch = origFetch
  }
})

test('GET /api/health, CORS, security headers, and app.scheduled() maintenance & operational alert on D1 failure', async () => {
  const { sqlite, env } = setupAdminDb()

  // 1. /api/health 200 & 503
  const h200 = await realApp.fetch(new Request('http://localhost/api/health'), env)
  assert.equal(h200.status, 200)
  const hJson = (await h200.json()) as any
  assert.equal(hJson.status, 'ok')
  assert.equal(hJson.db, true)
  assert.equal(hJson.tables.services, true)
  assert.equal(hJson.config.sessionSecret, true)
  assert.equal(hJson.config.square, true)
  assert.equal(hJson.config.email, true)

  const h503 = await realApp.fetch(
    new Request('http://localhost/api/health'),
    { DB: { prepare: () => { throw new Error('DB_OFFLINE') } } } as any
  )
  assert.equal(h503.status, 503)

  // 2. CORS (Origin: null & untrusted rejected; allowed accepted) + security headers
  const corsNull = await realApp.fetch(
    new Request('http://localhost/api/health', { headers: { Origin: 'null' } }),
    env
  )
  assert.equal(corsNull.headers.get('Access-Control-Allow-Origin'), null)
  assert.ok(corsNull.headers.get('Vary')?.includes('Origin'))

  const corsEvil = await realApp.fetch(
    new Request('http://localhost/api/health', { headers: { Origin: 'https://evil.example' } }),
    env
  )
  assert.equal(corsEvil.headers.get('Access-Control-Allow-Origin'), null)

  const corsAllowed = await realApp.fetch(
    new Request('http://localhost/api/health', { headers: { Origin: 'https://r59media.com' } }),
    env
  )
  assert.equal(corsAllowed.headers.get('Access-Control-Allow-Origin'), 'https://r59media.com')
  assert.ok(corsAllowed.headers.get('Content-Security-Policy')?.includes("object-src 'none'"))
  assert.equal(corsAllowed.headers.get('X-Frame-Options'), 'SAMEORIGIN')
  assert.equal(corsAllowed.headers.get('X-Content-Type-Options'), 'nosniff')
  assert.equal(corsAllowed.headers.get('Referrer-Policy'), 'strict-origin-when-cross-origin')

  // 3. app.scheduled() prunes stale CREATING invoices, orphan Media_Storage >24h, old Leads >365d
  sqlite.exec(`
    INSERT INTO Booking_Invoices (booking_id, attempt_key, amount_cents, status, created_at)
      VALUES (1, 'stale_cron_1', 0, 'CREATING', '2020-01-01 00:00:00');
    INSERT INTO Media_Storage (file_key, chunk_index, content_type, data, created_at)
      VALUES ('orphan_old.webp', 0, 'image/webp', X'00', '2020-01-01 00:00:00');
    INSERT INTO Leads (name, email, message, created_at)
      VALUES ('Old Lead', 'old@example.com', 'old', '2020-01-01 00:00:00');
  `)

  const waitPromises: Promise<unknown>[] = []
  const ctx = { waitUntil: (p: Promise<unknown>) => waitPromises.push(p) } as any
  await workerEntry.scheduled({ cron: '0 3 * * *' } as any, env, ctx)
  await Promise.all(waitPromises)

  assert.equal((sqlite.prepare("SELECT COUNT(*) AS cnt FROM Booking_Invoices WHERE attempt_key = 'stale_cron_1'").get() as any).cnt, 0)
  assert.equal((sqlite.prepare("SELECT COUNT(*) AS cnt FROM Media_Storage WHERE file_key = 'orphan_old.webp'").get() as any).cnt, 0)
  assert.equal((sqlite.prepare("SELECT COUNT(*) AS cnt FROM Leads WHERE email = 'old@example.com'").get() as any).cnt, 0)

  // 4. app.scheduled() catches D1 failure and triggers operational alert without unhandled rejection
  const origFetch = globalThis.fetch
  const origErr = console.error
  let alertSent = false
  console.error = () => {}
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).includes('api.resend.com/emails')) {
      const payload = JSON.parse(String(init?.body || '{}'))
      if (String(payload.subject).includes('Cron Maintenance Failed')) alertSent = true
      return new Response(JSON.stringify({ id: 'alert_1' }), { status: 200 })
    }
    return new Response('{}', { status: 404 })
  }) as typeof fetch

  try {
    const failPromises: Promise<unknown>[] = []
    const failEnv: Bindings = {
      ...env,
      DB: { prepare: () => { throw new Error('CRON_DB_DOWN') } } as any
    }
    await workerEntry.scheduled({ cron: '0 3 * * *' } as any, failEnv, { waitUntil: (p: Promise<unknown>) => failPromises.push(p) } as any)
    await Promise.all(failPromises)
    assert.equal(alertSent, true)
  } finally {
    globalThis.fetch = origFetch
    console.error = origErr
  }
})
