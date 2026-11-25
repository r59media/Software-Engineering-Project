import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { Hono, type Context } from 'hono'
import { signMediaKey, verifyMediaSignature, parseRangeHeader } from '../src/utils/signedUrl.ts'
import { adminAuth, createSessionToken, getSigningSecret, getMediaSigningSecret, verifySessionToken, isTokenRevokedInDb } from '../src/middleware/auth.ts'
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

function setupTestEnv() {
  const sqlite = new DatabaseSync(':memory:')
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS Admin_Settings (
      setting_key TEXT PRIMARY KEY,
      setting_value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS Revoked_Sessions (
      signature TEXT PRIMARY KEY,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS Portfolio_Images (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      media_key TEXT NOT NULL,
      section TEXT NOT NULL DEFAULT 'gallery',
      category TEXT,
      title TEXT,
      alt_text TEXT,
      display_order INTEGER NOT NULL DEFAULT 0,
      is_featured INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS Media_Storage (
      file_key TEXT NOT NULL,
      chunk_index INTEGER NOT NULL,
      content_type TEXT NOT NULL DEFAULT 'image/webp',
      data BLOB NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (file_key, chunk_index)
    );
  `)

  const env: Bindings = {
    DB: createD1(sqlite),
    SESSION_SECRET: 'a'.repeat(32),
    ADMIN_EMAIL: 'r59mediatesting@gmail.com',
    MEDIA_SIGNING_SECRET: 'test-media-signing-secret-32-chars-ok',
    ENVIRONMENT: 'development'
  }

  return { sqlite, env }
}

test('signMediaKey and verifyMediaSignature generate and validate HMAC short-lived signatures', async () => {
  const secret = 'test-signing-secret'
  const fileKey = 'sample-photo.webp'

  const { exp, sig } = await signMediaKey(fileKey, secret, 30)

  assert.ok(exp > Math.floor(Date.now() / 1000), 'Expiration should be in future')
  assert.ok(typeof sig === 'string' && sig.length > 0, 'Signature should be non-empty')
  assert.ok(!sig.includes('+') && !sig.includes('/') && !sig.includes('='), 'Signature should be URL-safe base64')

  // Valid signature
  const valid = await verifyMediaSignature(fileKey, exp, sig, secret)
  assert.equal(valid, true, 'Valid signature must verify successfully')

  // Wrong fileKey
  const wrongKey = await verifyMediaSignature('different.webp', exp, sig, secret)
  assert.equal(wrongKey, false, 'Signature with wrong fileKey must fail')

  // Wrong secret
  const wrongSecret = await verifyMediaSignature(fileKey, exp, sig, 'other-secret')
  assert.equal(wrongSecret, false, 'Signature with wrong secret must fail')

  // Tampered signature
  const tamperedSig = await verifyMediaSignature(fileKey, exp, sig + 'x', secret)
  assert.equal(tamperedSig, false, 'Tampered signature must fail')

  // Expired
  const expired = await verifyMediaSignature(fileKey, exp - 100, sig, secret)
  assert.equal(expired, false, 'Expired signature must fail')

  // Malformed parameters
  assert.equal(await verifyMediaSignature('', exp, sig, secret), false)
  assert.equal(await verifyMediaSignature(fileKey, NaN, sig, secret), false)
  assert.equal(await verifyMediaSignature(fileKey, exp, '', secret), false)
  assert.equal(await verifyMediaSignature(fileKey, exp, sig, ''), false)
})

test('HMAC signed media URL verification suite: valid signature, expired rejection, tampered key rejection, and CSP header assertion', async () => {
  const secret = 'test-signing-secret-32-chars-long-secure'

  // 1. Valid Signature Pass: generate 30s signed URL via signMediaKey() and assert verifyMediaSignature() returns true
  const validSign = await signMediaKey('invoice_1.pdf', secret, 30)
  assert.ok(validSign.exp > Math.floor(Date.now() / 1000), 'Expiration should be in future')
  assert.ok(typeof validSign.sig === 'string' && validSign.sig.length > 0, 'Signature should be non-empty')
  const isValid = await verifyMediaSignature('invoice_1.pdf', validSign.exp, validSign.sig, secret)
  assert.equal(isValid, true, 'Valid 30s signature must verify successfully')

  // 2. Expired Signature Reject: generate with ttlSeconds = -5 and assert verifyMediaSignature() returns false
  const expiredSign = await signMediaKey('invoice_1.pdf', secret, -5)
  assert.ok(expiredSign.exp < Math.floor(Date.now() / 1000), 'Expiration should be in past')
  const isExpiredValid = await verifyMediaSignature('invoice_1.pdf', expiredSign.exp, expiredSign.sig, secret)
  assert.equal(isExpiredValid, false, 'Expired signature generated with ttlSeconds = -5 must return false')

  // 3. Tampered Key Reject: sign invoice_1.pdf and verify with invoice_2.pdf -> assert false
  const isTamperedValid = await verifyMediaSignature('invoice_2.pdf', validSign.exp, validSign.sig, secret)
  assert.equal(isTamperedValid, false, 'Signature verified with tampered file key invoice_2.pdf must return false')

  // 4. CSP Header Assertion: request public endpoint (e.g. GET /api/portfolio) and assert Content-Security-Policy header is present and contains worker-src 'self' and 'wasm-unsafe-eval'
  const { env } = setupTestEnv()
  const app = new Hono<{ Bindings: Bindings }>()
  app.use('*', async (c, next) => {
    await next()
    c.header(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self' 'wasm-unsafe-eval' https://accounts.google.com/gsi/client https://web.squarecdn.com https://sandbox.web.squarecdn.com; connect-src 'self' https://accounts.google.com/gsi/ https://connect.squareup.com https://pci-connect.squareup.com https://pci-connect.squareupsandbox.com; frame-src https://accounts.google.com/gsi/ https://web.squarecdn.com https://sandbox.web.squarecdn.com; img-src 'self' data: blob:; font-src 'self' https://fonts.gstatic.com data:; style-src 'self' 'unsafe-inline' https://accounts.google.com/gsi/style; worker-src 'self'; object-src 'none'; base-uri 'self'"
    )
  })
  app.get('/api/portfolio', (c) => c.json({ status: 'success', images: [] }))

  const res = await app.request('/api/portfolio', { method: 'GET' }, env)
  assert.equal(res.status, 200)
  const cspHeader = res.headers.get('Content-Security-Policy')
  assert.ok(cspHeader, 'Content-Security-Policy header must be present')
  assert.ok(cspHeader.includes("worker-src 'self'"), "Content-Security-Policy header must contain worker-src 'self'")
  assert.ok(cspHeader.includes("'wasm-unsafe-eval'"), "Content-Security-Policy header must contain 'wasm-unsafe-eval'")
  assert.match(
    cspHeader,
    /script-src\s+[^;]*'wasm-unsafe-eval'/,
    "Content-Security-Policy script-src directive must contain 'wasm-unsafe-eval'"
  )

  // Verify that backend/src/index.ts entrypoint defines worker-src 'self' and 'wasm-unsafe-eval' CSP directives
  const fs = await import('node:fs')
  const path = await import('node:path')
  const indexTs = fs.readFileSync(path.resolve(import.meta.dirname, '../src/index.ts'), 'utf8')
  assert.ok(
    indexTs.includes("worker-src 'self'"),
    "backend/src/index.ts must configure worker-src 'self' in CSP"
  )
  assert.ok(
    indexTs.includes("'wasm-unsafe-eval'"),
    "backend/src/index.ts must configure 'wasm-unsafe-eval' in CSP"
  )
  assert.match(
    indexTs,
    /script-src\s+[^;]*'wasm-unsafe-eval'/,
    "backend/src/index.ts script-src CSP directive must include 'wasm-unsafe-eval'"
  )
})

test('parseRangeHeader conforms to RFC 7233 range parsing', () => {
  const totalLength = 1000

  // Standard slice
  assert.deepEqual(parseRangeHeader('bytes=0-499', totalLength), { start: 0, end: 499 })

  // 512KB chunk equivalent
  assert.deepEqual(parseRangeHeader('bytes=0-524287', 1048576), { start: 0, end: 524287 })

  // Prefix range
  assert.deepEqual(parseRangeHeader('bytes=500-', totalLength), { start: 500, end: 999 })

  // Suffix range
  assert.deepEqual(parseRangeHeader('bytes=-200', totalLength), { start: 800, end: 999 })

  // Suffix range larger than total length clamped to 0
  assert.deepEqual(parseRangeHeader('bytes=-2000', totalLength), { start: 0, end: 999 })

  // Unsatisfiable cases
  assert.equal(parseRangeHeader('bytes=1000-', totalLength), 'unsatisfiable')
  assert.equal(parseRangeHeader('bytes=500-200', totalLength), 'unsatisfiable')
  assert.equal(parseRangeHeader('bytes=2000-2500', totalLength), 'unsatisfiable')

  // Invalid / missing
  assert.equal(parseRangeHeader('', totalLength), null)
  assert.equal(parseRangeHeader('items=0-10', totalLength), null)
  assert.equal(parseRangeHeader('bytes=', totalLength), null)
  assert.equal(parseRangeHeader(null, totalLength), null)
})

test('POST /api/admin/media-token route generates signed URL with 30s TTL', async () => {
  const { env } = setupTestEnv()
  const token = await createSessionToken(env.SESSION_SECRET!, env.ADMIN_EMAIL!)

  const app = new Hono<{ Bindings: Bindings }>()
  app.use('*', adminAuth)
  app.post('/api/admin/media-token', async (c) => {
    try {
      const body = await c.req.json().catch(() => null)
      const fileKey = typeof body?.file_key === 'string' ? body.file_key.trim() : ''
      if (!fileKey || fileKey.includes('..')) {
        return c.json({
          error: {
            code: 'BAD_REQUEST',
            message: 'Invalid or missing file_key',
            details: []
          }
        }, 400)
      }

      const secret = c.env.MEDIA_SIGNING_SECRET || c.env.SQUARE_WEBHOOK_SIGNATURE_KEY || 'default-secret'
      const { exp, sig } = await signMediaKey(fileKey, secret, 30)

      return c.json({
        url: `/api/media/${fileKey}?exp=${exp}&sig=${sig}`
      }, 200)
    } catch {
      return c.json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'Failed' } }, 500)
    }
  })

  // 1. Unauthorized request
  const unauthRes = await app.request('/api/admin/media-token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ file_key: 'test.webp' })
  }, env)
  assert.equal(unauthRes.status, 401)

  // 2. Bad request (missing file_key)
  const badReqRes = await app.request('/api/admin/media-token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({})
  }, env)
  assert.equal(badReqRes.status, 400)

  // 3. Successful token generation
  const successRes = await app.request('/api/admin/media-token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ file_key: 'photos/portrait.webp' })
  }, env)
  assert.equal(successRes.status, 200)
  const json = await successRes.json() as { url: string }
  assert.ok(json.url.startsWith('/api/media/photos/portrait.webp?exp='))
  assert.ok(json.url.includes('&sig='))

  const parsedUrl = new URL(`http://localhost${json.url}`)
  const exp = Number(parsedUrl.searchParams.get('exp'))
  const sig = parsedUrl.searchParams.get('sig')!
  const now = Math.floor(Date.now() / 1000)
  assert.ok(exp >= now + 25 && exp <= now + 35, 'TTL should be ~30s')

  const valid = await verifyMediaSignature('photos/portrait.webp', exp, sig, env.MEDIA_SIGNING_SECRET!)
  assert.equal(valid, true)
})

test('Media handler validates HMAC signature and streams chunks via HTTP Range', async () => {
  const { sqlite, env } = setupTestEnv()
  const secret = env.MEDIA_SIGNING_SECRET!

  const chunk0 = Buffer.from('0123456789')
  const chunk1 = Buffer.from('abcdefghij')
  sqlite.prepare('INSERT INTO Media_Storage (file_key, chunk_index, content_type, data) VALUES (?, ?, ?, ?)').run(
    'test.webp', 0, 'image/webp', chunk0
  )
  sqlite.prepare('INSERT INTO Media_Storage (file_key, chunk_index, content_type, data) VALUES (?, ?, ?, ?)').run(
    'test.webp', 1, 'image/webp', chunk1
  )

  const app = new Hono<{ Bindings: Bindings }>()
  app.get('/api/media/:file_key{.*}', async (c) => {
    const fileKeyParam = c.req.param('file_key')
    const url = new URL(c.req.url)
    const fileKey = fileKeyParam
      ? decodeURIComponent(fileKeyParam).replace(/^\/+/, '')
      : decodeURIComponent(url.pathname.replace(/^\/api\/media\//, '')).replace(/^\/+/, '')

    const exp = c.req.query('exp')
    const sig = c.req.query('sig')
    const sec = c.env.MEDIA_SIGNING_SECRET || c.env.SQUARE_WEBHOOK_SIGNATURE_KEY || 'default-secret'

    if (exp || sig) {
      const isValid = exp && sig ? await verifyMediaSignature(fileKey, Number(exp), sig, sec) : false
      if (!isValid) {
        return c.json({ status: 'error', code: 'UNAUTHORIZED', message: 'Invalid or expired media signature' }, 401)
      }
    } else {
      return c.redirect('/', 302)
    }

    const rows = await c.env.DB.prepare(
      'SELECT chunk_index, content_type, data FROM Media_Storage WHERE file_key = ? ORDER BY chunk_index ASC'
    ).bind(fileKey).all<{ chunk_index: number; content_type: string; data: any }>()

    if (!rows?.results || rows.results.length === 0) return c.notFound()

    const chunks: Uint8Array[] = rows.results.map((r: any) => new Uint8Array(r.data))
    const totalLength = chunks.reduce((acc, ch) => acc + ch.byteLength, 0)
    const combined = new Uint8Array(totalLength)
    let off = 0
    for (const ch of chunks) {
      combined.set(ch, off)
      off += ch.byteLength
    }

    const rangeHeader = c.req.header('Range')
    if (rangeHeader) {
      const parsed = parseRangeHeader(rangeHeader, totalLength)
      if (parsed === 'unsatisfiable') {
        return new Response(null, {
          status: 416,
          headers: { 'Content-Range': `bytes */${totalLength}`, 'Accept-Ranges': 'bytes' }
        })
      }
      if (parsed) {
        const slice = combined.subarray(parsed.start, parsed.end + 1)
        return new Response(slice, {
          status: 206,
          headers: {
            'Content-Type': 'image/webp',
            'Content-Range': `bytes ${parsed.start}-${parsed.end}/${totalLength}`,
            'Content-Length': String(slice.byteLength),
            'Accept-Ranges': 'bytes'
          }
        })
      }
    }

    return new Response(combined, {
      status: 200,
      headers: {
        'Content-Type': 'image/webp',
        'Content-Length': String(totalLength),
        'Accept-Ranges': 'bytes'
      }
    })
  })

  // 1. Valid signed URL retrieval
  const { exp, sig } = await signMediaKey('test.webp', secret, 30)
  const res200 = await app.request(`/api/media/test.webp?exp=${exp}&sig=${sig}`, { method: 'GET' }, env)
  assert.equal(res200.status, 200)
  assert.equal(res200.headers.get('Content-Length'), '20')
  assert.equal(res200.headers.get('Accept-Ranges'), 'bytes')
  assert.equal(await res200.text(), '0123456789abcdefghij')

  // 2. Tampered signature
  const res401Tampered = await app.request(`/api/media/test.webp?exp=${exp}&sig=tampered`, { method: 'GET' }, env)
  assert.equal(res401Tampered.status, 401)

  // 3. Range request (first 10 bytes)
  const res206First = await app.request(`/api/media/test.webp?exp=${exp}&sig=${sig}`, {
    method: 'GET',
    headers: { Range: 'bytes=0-9' }
  }, env)
  assert.equal(res206First.status, 206)
  assert.equal(res206First.headers.get('Content-Range'), 'bytes 0-9/20')
  assert.equal(res206First.headers.get('Content-Length'), '10')
  assert.equal(await res206First.text(), '0123456789')

  // 4. Range request (second 10 bytes)
  const res206Second = await app.request(`/api/media/test.webp?exp=${exp}&sig=${sig}`, {
    method: 'GET',
    headers: { Range: 'bytes=10-19' }
  }, env)
  assert.equal(res206Second.status, 206)
  assert.equal(res206Second.headers.get('Content-Range'), 'bytes 10-19/20')
  assert.equal(res206Second.headers.get('Content-Length'), '10')
  assert.equal(await res206Second.text(), 'abcdefghij')

  // 5. Unsatisfiable range -> 416
  const res416 = await app.request(`/api/media/test.webp?exp=${exp}&sig=${sig}`, {
    method: 'GET',
    headers: { Range: 'bytes=100-200' }
  }, env)
  assert.equal(res416.status, 416)
  assert.equal(res416.headers.get('Content-Range'), 'bytes */20')
})

// Uses realApp imported natively from ../src/index.ts

test('Private Media Bypass Probe: enforces Portfolio_Images.is_active and admin Bearer auth on /api/media/*', async () => {
  const { sqlite, env } = setupTestEnv()
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS Services (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      image_url TEXT,
      is_active INTEGER NOT NULL DEFAULT 1
    );
  `)

  const privateBytes = Buffer.from('PRIVATE-SECRET-IMAGE-BYTES')
  const hiddenBytes = Buffer.from('HIDDEN-INACTIVE-IMAGE-BYTES')
  const activeBytes = Buffer.from('ACTIVE-PUBLIC-IMAGE-BYTES')

  sqlite.prepare('INSERT INTO Media_Storage (file_key, chunk_index, content_type, data) VALUES (?, ?, ?, ?)').run(
    'private-secret.webp', 0, 'image/webp', privateBytes
  )
  sqlite.prepare('INSERT INTO Media_Storage (file_key, chunk_index, content_type, data) VALUES (?, ?, ?, ?)').run(
    'hidden-photo.webp', 0, 'image/webp', hiddenBytes
  )
  sqlite.prepare('INSERT INTO Media_Storage (file_key, chunk_index, content_type, data) VALUES (?, ?, ?, ?)').run(
    'active-photo.webp', 0, 'image/webp', activeBytes
  )

  sqlite.prepare('INSERT INTO Portfolio_Images (media_key, is_active) VALUES (?, ?)').run('hidden-photo.webp', 0)
  sqlite.prepare('INSERT INTO Portfolio_Images (media_key, is_active) VALUES (?, ?)').run('active-photo.webp', 1)

  // realApp already imported

  // 1. Unlisted private media with X-R59-Client: media-viewer and NO admin token -> 302 redirect, no bytes leaked
  const resPrivate = await realApp.fetch(
    new Request('http://localhost/api/media/private-secret.webp', {
      headers: { 'X-R59-Client': 'media-viewer' }
    }),
    env
  )
  assert.equal(resPrivate.status, 302)
  assert.equal(resPrivate.headers.get('Location'), '/')
  const privateBody = await resPrivate.text()
  assert.ok(!privateBody.includes('PRIVATE-SECRET-IMAGE-BYTES'), 'Private image bytes must never leak')

  // 2. Inactive portfolio media (is_active = 0) with X-R59-Client: media-viewer and NO admin token -> 302 redirect, no bytes leaked
  const resHidden = await realApp.fetch(
    new Request('http://localhost/api/media/hidden-photo.webp', {
      headers: { 'X-R59-Client': 'media-viewer' }
    }),
    env
  )
  assert.equal(resHidden.status, 302)
  assert.equal(resHidden.headers.get('Location'), '/')
  const hiddenBody = await resHidden.text()
  assert.ok(!hiddenBody.includes('HIDDEN-INACTIVE-IMAGE-BYTES'), 'Hidden image bytes must never leak')

  // 3. Active portfolio media (is_active = 1) with X-R59-Client: media-viewer -> 200 and bytes served
  const resActive = await realApp.fetch(
    new Request('http://localhost/api/media/active-photo.webp', {
      headers: { 'X-R59-Client': 'media-viewer' }
    }),
    env
  )
  assert.equal(resActive.status, 200)
  assert.equal(await resActive.text(), 'ACTIVE-PUBLIC-IMAGE-BYTES')

  // 4. Inactive portfolio media (is_active = 0) WITH valid Admin Bearer token -> 200 (Admin preview works)
  const adminToken = await createSessionToken(env.SESSION_SECRET!, env.ADMIN_EMAIL!)
  const resAdminPreview = await realApp.fetch(
    new Request('http://localhost/api/media/hidden-photo.webp', {
      headers: { Authorization: `Bearer ${adminToken}` }
    }),
    env
  )
  assert.equal(resAdminPreview.status, 200)
  assert.equal(await resAdminPreview.text(), 'HIDDEN-INACTIVE-IMAGE-BYTES')
})

test('Cross-Protocol Key Confusion: getMediaSigningSecret rejects signatures forged with SQUARE_WEBHOOK_SIGNATURE_KEY or raw SESSION_SECRET', async () => {
  const fileKey = 'private-proof.webp'
  const sessionSecret = 'session-secret-at-least-32-characters-long'
  const squareWebhookKey = 'square-webhook-key-at-least-32-chars-long'

  // Case A: Domain-separated derivation from SESSION_SECRET when MEDIA_SIGNING_SECRET is unset
  const derivedEnv: Bindings = {
    DB: {} as any,
    SESSION_SECRET: sessionSecret,
    SQUARE_WEBHOOK_SIGNATURE_KEY: squareWebhookKey
  }
  const derivedMediaSecret = await getMediaSigningSecret(derivedEnv)
  assert.ok(derivedMediaSecret, 'getMediaSigningSecret must derive a secret from SESSION_SECRET')
  assert.notEqual(derivedMediaSecret, sessionSecret, 'Derived media secret must be domain-separated from SESSION_SECRET')
  assert.notEqual(derivedMediaSecret, squareWebhookKey, 'Derived media secret must never equal SQUARE_WEBHOOK_SIGNATURE_KEY')

  const forgedWithSquare = await signMediaKey(fileKey, squareWebhookKey, 30)
  const forgedWithSession = await signMediaKey(fileKey, sessionSecret, 30)

  assert.equal(
    await verifyMediaSignature(fileKey, forgedWithSquare.exp, forgedWithSquare.sig, derivedMediaSecret!),
    false,
    'Signature forged with SQUARE_WEBHOOK_SIGNATURE_KEY must be rejected'
  )
  assert.equal(
    await verifyMediaSignature(fileKey, forgedWithSession.exp, forgedWithSession.sig, derivedMediaSecret!),
    false,
    'Signature forged with raw SESSION_SECRET must be rejected'
  )

  const validDerived = await signMediaKey(fileKey, derivedMediaSecret!, 30)
  assert.equal(
    await verifyMediaSignature(fileKey, validDerived.exp, validDerived.sig, derivedMediaSecret!),
    true,
    'Signature generated with getMediaSigningSecret must verify'
  )

  // Case B: Dedicated MEDIA_SIGNING_SECRET configured
  const dedicatedEnv: Bindings = {
    DB: {} as any,
    SESSION_SECRET: sessionSecret,
    SQUARE_WEBHOOK_SIGNATURE_KEY: squareWebhookKey,
    MEDIA_SIGNING_SECRET: 'dedicated-media-signing-secret-32-chars'
  }
  const dedicatedMediaSecret = await getMediaSigningSecret(dedicatedEnv)
  assert.equal(dedicatedMediaSecret, dedicatedEnv.MEDIA_SIGNING_SECRET)
  assert.equal(
    await verifyMediaSignature(fileKey, forgedWithSquare.exp, forgedWithSquare.sig, dedicatedMediaSecret!),
    false
  )
  assert.equal(
    await verifyMediaSignature(fileKey, forgedWithSession.exp, forgedWithSession.sig, dedicatedMediaSecret!),
    false
  )
  const validDedicated = await signMediaKey(fileKey, dedicatedMediaSecret!, 30)
  assert.equal(
    await verifyMediaSignature(fileKey, validDedicated.exp, validDedicated.sig, dedicatedMediaSecret!),
    true
  )
})

test('Media Fast-Path, ETag/304, and Chunk-Bounded Range Requests preserve security headers', async () => {
  const { sqlite, env } = setupTestEnv()
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS Services (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      image_url TEXT,
      is_active INTEGER NOT NULL DEFAULT 1
    );
  `)

  // Multi-chunk variable-size media
  sqlite.prepare('INSERT INTO Media_Storage (file_key, chunk_index, content_type, data, created_at) VALUES (?, ?, ?, ?, ?)').run(
    'chunked.webp', 0, 'image/webp', Buffer.from('0123456789'), '2026-01-01T00:00:00Z'
  )
  sqlite.prepare('INSERT INTO Media_Storage (file_key, chunk_index, content_type, data, created_at) VALUES (?, ?, ?, ?, ?)').run(
    'chunked.webp', 1, 'image/webp', Buffer.from('abcdefghij'), '2026-01-01T00:00:00Z'
  )
  sqlite.prepare('INSERT INTO Portfolio_Images (media_key, is_active) VALUES (?, ?)').run('chunked.webp', 1)

  // realApp already imported

  // 1. 200 OK returns ETag and security headers
  const res200 = await realApp.fetch(
    new Request('http://localhost/api/media/chunked.webp', {
      headers: { 'X-R59-Client': 'media-viewer' }
    }),
    env
  )
  assert.equal(res200.status, 200)
  const etag = res200.headers.get('ETag')
  assert.equal(etag, '"media-chunked.webp-20-2026-01-01T00:00:00Z"')
  assert.equal(res200.headers.get('X-Content-Type-Options'), 'nosniff')
  assert.equal(res200.headers.get('Cross-Origin-Resource-Policy'), 'cross-origin')
  assert.equal(await res200.text(), '0123456789abcdefghij')

  // 2. If-None-Match returns 304 Not Modified with security headers
  const res304 = await realApp.fetch(
    new Request('http://localhost/api/media/chunked.webp', {
      headers: {
        'X-R59-Client': 'media-viewer',
        'If-None-Match': etag!
      }
    }),
    env
  )
  assert.equal(res304.status, 304)
  assert.equal(res304.headers.get('ETag'), etag)
  assert.equal(res304.headers.get('X-Content-Type-Options'), 'nosniff')
  assert.equal(res304.headers.get('Cross-Origin-Resource-Policy'), 'cross-origin')
  assert.equal(
    res304.headers.get('Cache-Control'),
    'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800'
  )

  // 3. Cross-chunk Range request returns exact 206 slice
  const res206 = await realApp.fetch(
    new Request('http://localhost/api/media/chunked.webp', {
      headers: {
        'X-R59-Client': 'media-viewer',
        Range: 'bytes=5-14'
      }
    }),
    env
  )
  assert.equal(res206.status, 206)
  assert.equal(res206.headers.get('Content-Range'), 'bytes 5-14/20')
  assert.equal(res206.headers.get('Content-Length'), '10')
  assert.equal(await res206.text(), '56789abcde')

  // 4. Unsatisfiable Range returns 416
  const res416 = await realApp.fetch(
    new Request('http://localhost/api/media/chunked.webp', {
      headers: {
        'X-R59-Client': 'media-viewer',
        Range: 'bytes=100-200'
      }
    }),
    env
  )
  assert.equal(res416.status, 416)
  assert.equal(res416.headers.get('Content-Range'), 'bytes */20')

  // 5. Sec-Fetch-Dest: document & Sec-Fetch-Site: cross-site remain blocked
  const resDoc = await realApp.fetch(
    new Request('http://localhost/api/media/chunked.webp', {
      headers: { 'Sec-Fetch-Dest': 'document', 'X-R59-Client': 'media-viewer' }
    }),
    env
  )
  assert.equal(resDoc.status, 302)

  const resCross = await realApp.fetch(
    new Request('http://localhost/api/media/chunked.webp', {
      headers: { 'Sec-Fetch-Site': 'cross-site', 'X-R59-Client': 'media-viewer' }
    }),
    env
  )
  assert.equal(resCross.status, 403)
})

test('Static /assets/* and /models/* allow same-origin subresource requests and block document/cross-site requests', async () => {
  const { env } = setupTestEnv()
  const assetEnv: Bindings = {
    ...env,
    ASSETS: {
      fetch: async (req: Request) =>
        new Response(`ASSET:${new URL(req.url).pathname}`, {
          status: 200,
          headers: { 'Content-Type': 'image/webp' }
        })
    } as any
  }

  // realApp already imported
  const paths = ['/assets/session-paper.webp', '/models/r59-memory-card-preview.webp']

  for (const path of paths) {
    // 1. Same-origin image subresource with Sec-Fetch-Site: same-origin -> 200
    const resSameOrigin = await realApp.fetch(
      new Request(`http://localhost${path}`, {
        headers: {
          'Sec-Fetch-Site': 'same-origin',
          'Sec-Fetch-Dest': 'image'
        }
      }),
      assetEnv
    )
    assert.equal(resSameOrigin.status, 200, `${path} must allow Sec-Fetch-Site: same-origin + Sec-Fetch-Dest: image`)
    assert.equal(await resSameOrigin.text(), `ASSET:${path}`)

    // 2. Same-origin Referer when Sec-Fetch-Site is absent -> 200
    const resSameReferer = await realApp.fetch(
      new Request(`http://localhost${path}`, {
        headers: {
          Referer: 'http://localhost/book',
          'Sec-Fetch-Dest': 'image'
        }
      }),
      assetEnv
    )
    assert.equal(resSameReferer.status, 200, `${path} must allow same-origin Referer when Sec-Fetch-Site is absent`)
    assert.equal(await resSameReferer.text(), `ASSET:${path}`)

    // 3. Sec-Fetch-Dest: document -> 302 redirect
    const resDoc = await realApp.fetch(
      new Request(`http://localhost${path}`, {
        headers: {
          'Sec-Fetch-Site': 'same-origin',
          'Sec-Fetch-Dest': 'document'
        }
      }),
      assetEnv
    )
    assert.equal(resDoc.status, 302, `${path} must block Sec-Fetch-Dest: document with 302`)

    // 4. Sec-Fetch-Site: cross-site -> 403 Forbidden
    const resCrossSite = await realApp.fetch(
      new Request(`http://localhost${path}`, {
        headers: {
          'Sec-Fetch-Site': 'cross-site',
          'Sec-Fetch-Dest': 'image'
        }
      }),
      assetEnv
    )
    assert.equal(resCrossSite.status, 403, `${path} must block Sec-Fetch-Site: cross-site with 403`)

    // 5. Cross-origin Referer when Sec-Fetch-Site is absent -> 302 redirect
    const resCrossReferer = await realApp.fetch(
      new Request(`http://localhost${path}`, {
        headers: {
          Referer: 'https://evil.example/page',
          'Sec-Fetch-Dest': 'image'
        }
      }),
      assetEnv
    )
    assert.equal(resCrossReferer.status, 302, `${path} must block cross-origin Referer when Sec-Fetch-Site is absent`)
  }
})

test('HMAC-signed ?w=640|1280 media variants: signature validation, tampered w rejection, seamless fallback, PUT variant, and delete cleanup', async () => {
  const { sqlite, env } = setupTestEnv()
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS Services (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      image_url TEXT,
      is_active INTEGER NOT NULL DEFAULT 1
    );
  `)

  const secret = env.MEDIA_SIGNING_SECRET!
  const fileKey = 'variant-photo.webp'

  // 1. Unit-level width signature checks
  const signed640 = await signMediaKey(fileKey, secret, 30, 640)
  assert.equal(await verifyMediaSignature(fileKey, signed640.exp, signed640.sig, secret, 640), true)
  assert.equal(await verifyMediaSignature(fileKey, signed640.exp, signed640.sig, secret, 1280), false, 'Tampered width 1280 must fail')
  assert.equal(await verifyMediaSignature(fileKey, signed640.exp, signed640.sig, secret), false, 'Stripped width must fail')

  const signedOrig = await signMediaKey(fileKey, secret, 30)
  assert.equal(await verifyMediaSignature(fileKey, signedOrig.exp, signedOrig.sig, secret), true)
  assert.equal(await verifyMediaSignature(fileKey, signedOrig.exp, signedOrig.sig, secret, 640), false, 'Adding width to original signature must fail')

  // Seed original and w640 variant (no w1280 variant -> tests seamless fallback)
  sqlite.prepare('INSERT INTO Media_Storage (file_key, chunk_index, content_type, data) VALUES (?, ?, ?, ?)').run(
    fileKey, 0, 'image/webp', Buffer.from('ORIGINAL-BYTES')
  )
  sqlite.prepare('INSERT INTO Media_Storage (file_key, chunk_index, content_type, data) VALUES (?, ?, ?, ?)').run(
    `${fileKey}__w640`, 0, 'image/webp', Buffer.from('W640-BYTES')
  )
  sqlite.prepare('INSERT INTO Portfolio_Images (media_key, is_active) VALUES (?, ?)').run(fileKey, 1)
  const insertedRow = sqlite.prepare('SELECT id FROM Portfolio_Images WHERE media_key = ?').get(fileKey) as { id: number }

  // realApp already imported
  const adminToken = await createSessionToken(env.SESSION_SECRET!, env.ADMIN_EMAIL!)

  // 2. POST /api/media-token with w=640
  const pubTokenRes = await realApp.fetch(
    new Request('http://localhost/api/media-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file_key: fileKey, w: 640 })
    }),
    env
  )
  assert.equal(pubTokenRes.status, 200)
  const pubTokenJson = await pubTokenRes.json() as { url: string }
  assert.ok(pubTokenJson.url.includes('&w=640'), 'Public media-token must append &w=640')

  // 3. GET with valid ?w=640 serves variant bytes
  const res640 = await realApp.fetch(new Request(`http://localhost${pubTokenJson.url}`), env)
  assert.equal(res640.status, 200)
  assert.equal(await res640.text(), 'W640-BYTES')

  // 4. Tampered ?w=1280 using the 640 signature is rejected with 401
  const tamperedUrl = pubTokenJson.url.replace('&w=640', '&w=1280')
  const resTampered = await realApp.fetch(new Request(`http://localhost${tamperedUrl}`), env)
  assert.equal(resTampered.status, 401)

  // 5. POST /api/admin/media-token with w=1280 -> seamless fallback to original when __w1280 doesn't exist
  const adminTokenRes1280 = await realApp.fetch(
    new Request('http://localhost/api/admin/media-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ file_key: fileKey, w: 1280 })
    }),
    env
  )
  assert.equal(adminTokenRes1280.status, 200)
  const adminJson1280 = await adminTokenRes1280.json() as { url: string }
  assert.ok(adminJson1280.url.includes('&w=1280'))

  const resFallback = await realApp.fetch(new Request(`http://localhost${adminJson1280.url}`), env)
  assert.equal(resFallback.status, 200)
  assert.equal(await resFallback.text(), 'ORIGINAL-BYTES', 'Missing w1280 variant must fall back seamlessly to original')

  // 6. POST /api/admin/media-token ignores invalid w=999
  const adminTokenInvalidW = await realApp.fetch(
    new Request('http://localhost/api/admin/media-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ file_key: fileKey, w: 999 })
    }),
    env
  )
  assert.equal(adminTokenInvalidW.status, 200)
  const adminJsonInvalidW = await adminTokenInvalidW.json() as { url: string }
  assert.ok(!adminJsonInvalidW.url.includes('&w='), 'Invalid width must be ignored and treated as original')

  // 7. PUT /api/admin/media/<key>?variant=1280 stores __w1280 and bumps public_cache_version
  const w1280Payload = Buffer.concat([Buffer.from('RIFF\x1a\x00\x00\x00WEBPVP8 '), Buffer.from('W1280-UPLOADED')])
  const putVariantRes = await realApp.fetch(
    new Request(`http://localhost/api/admin/media/${fileKey}?variant=1280`, {
      method: 'PUT',
      headers: { 'Content-Type': 'image/webp', Authorization: `Bearer ${adminToken}` },
      body: w1280Payload
    }),
    env
  )
  assert.equal(putVariantRes.status, 200)
  const stored1280 = sqlite.prepare('SELECT data FROM Media_Storage WHERE file_key = ?').get(`${fileKey}__w1280`) as { data: Uint8Array } | undefined
  assert.ok(stored1280, 'PUT ?variant=1280 must store chunks under __w1280')
  assert.ok(Buffer.from(stored1280!.data).equals(w1280Payload))

  // 8. DELETE /api/admin/portfolio/:id removes original + __w640 + __w1280
  const delRes = await realApp.fetch(
    new Request(`http://localhost/api/admin/portfolio/${insertedRow.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` }
    }),
    env
  )
  assert.equal(delRes.status, 200)
  const remaining = sqlite.prepare('SELECT file_key FROM Media_Storage WHERE file_key IN (?, ?, ?)').all(
    fileKey,
    `${fileKey}__w640`,
    `${fileKey}__w1280`
  )
  assert.equal(remaining.length, 0, 'Deleting portfolio photo must also delete __w640 and __w1280 variants')
})

test('Static /assets/* overwrites upstream Cache-Control with immutable, omits Vary: Origin without Origin, preserves hotlink rules, and uses PoP edge cache after auth', async () => {
  const { env } = setupTestEnv()
  const edgeStore = new Map<string, Response>()
  let assetFetchCalls = 0

  const assetEnv: Bindings = {
    ...env,
    ASSETS: {
      fetch: async (req: Request) => {
        assetFetchCalls += 1
        const pathname = new URL(req.url).pathname
        const isGlb = pathname.endsWith('.glb')
        return new Response(`ASSET:${pathname}`, {
          status: 200,
          headers: {
            'Content-Type': isGlb ? 'model/gltf-binary' : 'image/webp',
            'Cache-Control': 'max-age=0',
            Vary: 'Origin',
            ETag: '"asset-v1"'
          }
        })
      }
    } as any
  }

  const originalCachesDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'caches')
  Object.defineProperty(globalThis, 'caches', {
    configurable: true,
    writable: true,
    value: {
      default: {
        match: async (req: Request) => {
          const hit = edgeStore.get(req.url)
          return hit ? hit.clone() : undefined
        },
        put: async (req: Request, res: Response) => {
          edgeStore.set(req.url, res.clone())
        }
      }
    }
  })

  try {
    // realApp already imported

    // 1. Authorized /assets/test-hash.webp overwrites upstream max-age=0 with immutable and strips Vary: Origin
    const res1 = await realApp.fetch(
      new Request('http://localhost/assets/test-hash.webp?v=1', {
        headers: {
          'Sec-Fetch-Site': 'same-origin',
          'Sec-Fetch-Dest': 'image'
        }
      }),
      assetEnv
    )
    assert.equal(res1.status, 200)
    assert.equal(res1.headers.get('Cache-Control'), 'public, max-age=31536000, immutable')
    assert.equal(res1.headers.get('Vary'), null, 'Static asset without Origin must not emit Vary: Origin')
    assert.equal(res1.headers.get('Cross-Origin-Resource-Policy'), 'cross-origin')
    assert.equal(res1.headers.get('Content-Disposition'), 'inline')
    assert.equal(res1.headers.get('X-Content-Type-Options'), 'nosniff')
    assert.equal(await res1.text(), 'ASSET:/assets/test-hash.webp')
    assert.equal(assetFetchCalls, 1)

    // 2. Hotlink rules MUST still block even when /assets/test-hash.webp is warm in PoP edge cache
    const resDoc = await realApp.fetch(
      new Request('http://localhost/assets/test-hash.webp', {
        headers: { 'Sec-Fetch-Site': 'same-origin', 'Sec-Fetch-Dest': 'document' }
      }),
      assetEnv
    )
    assert.equal(resDoc.status, 302)

    const resCross = await realApp.fetch(
      new Request('http://localhost/assets/test-hash.webp', {
        headers: { 'Sec-Fetch-Site': 'cross-site', 'Sec-Fetch-Dest': 'image' }
      }),
      assetEnv
    )
    assert.equal(resCross.status, 403)

    const resNoAuth = await realApp.fetch(
      new Request('http://localhost/assets/test-hash.webp'),
      assetEnv
    )
    assert.equal(resNoAuth.status, 302)

    // 3. Subsequent authorized request with different query string hits normalized PoP edge cache
    const res2 = await realApp.fetch(
      new Request('http://localhost/assets/test-hash.webp?v=2', {
        headers: {
          'Sec-Fetch-Site': 'same-origin',
          'Sec-Fetch-Dest': 'image'
        }
      }),
      assetEnv
    )
    assert.equal(res2.status, 200)
    assert.equal(res2.headers.get('Cache-Control'), 'public, max-age=31536000, immutable')
    assert.equal(res2.headers.get('Vary'), null)
    assert.equal(await res2.text(), 'ASSET:/assets/test-hash.webp')
    assert.equal(assetFetchCalls, 1, 'Normalized edge cache key must serve warm cache hit without calling ASSETS.fetch again')

    // 4. Conditional If-None-Match on warm PoP edge cache returns 304 with security headers
    const res304 = await realApp.fetch(
      new Request('http://localhost/assets/test-hash.webp', {
        headers: {
          'Sec-Fetch-Site': 'same-origin',
          'Sec-Fetch-Dest': 'image',
          'If-None-Match': '"asset-v1"'
        }
      }),
      assetEnv
    )
    assert.equal(res304.status, 304)
    assert.equal(res304.headers.get('X-Content-Type-Options'), 'nosniff')
    assert.equal(res304.headers.get('Vary'), null)

    // 5. Unhashed /models/*.glb sets 7-day SWR Cache-Control and omits Vary: Origin
    const resGlb = await realApp.fetch(
      new Request('http://localhost/models/r59-memory-card.glb', {
        headers: { 'Sec-Fetch-Site': 'same-origin', 'Sec-Fetch-Dest': 'empty' }
      }),
      assetEnv
    )
    assert.equal(resGlb.status, 200)
    assert.equal(resGlb.headers.get('Cache-Control'), 'public, max-age=604800, stale-while-revalidate=86400')
    assert.equal(resGlb.headers.get('Vary'), null)

    // 6. CORS and Vary: Origin continue to work identically on /api/* and /admin/*
    const resApiNoOrigin = await realApp.fetch(new Request('http://localhost/api/health'), assetEnv)
    assert.equal(resApiNoOrigin.status, 200)
    assert.equal(resApiNoOrigin.headers.get('Vary'), 'Origin')

    const resApiCors = await realApp.fetch(
      new Request('http://localhost/api/health', {
        headers: { Origin: 'http://localhost:5173' }
      }),
      assetEnv
    )
    assert.equal(resApiCors.status, 200)
    assert.equal(resApiCors.headers.get('Access-Control-Allow-Origin'), 'http://localhost:5173')
    assert.equal(resApiCors.headers.get('Vary'), 'Origin')

    const resAdminNoOrigin = await realApp.fetch(new Request('http://localhost/admin'), assetEnv)
    assert.equal(resAdminNoOrigin.status, 301)
    assert.equal(resAdminNoOrigin.headers.get('Vary'), 'Origin')
  } finally {
    if (originalCachesDescriptor) {
      Object.defineProperty(globalThis, 'caches', originalCachesDescriptor)
    } else {
      delete (globalThis as any).caches
    }
  }
})

test('HTML responses on / set bfcache-safe Cache-Control and emit up to 3 Link rel=preload Early Hints without Vary: Origin', async () => {
  const { env } = setupTestEnv()
  const mockHtml = `<!doctype html>
<html lang="en">
  <head>
    <link rel="preload" href="/assets/ClP0DXXT.woff2" as="font" type="font/woff2" crossorigin />
    <link rel="preload" href="/assets/CM4MMJ-t.woff2" as="font" type="font/woff2" crossorigin />
    <link rel="preload" href="/assets/extra-font.woff2" as="font" type="font/woff2" crossorigin />
    <link rel="modulepreload" crossorigin href="/assets/XKyaHtl9.js">
    <link rel="stylesheet" crossorigin href="/assets/BPn1yCOv.css">
  </head>
  <body><div id="root"></div></body>
</html>`

  const htmlEnv: Bindings = {
    ...env,
    ASSETS: {
      fetch: async () =>
        new Response(mockHtml, {
          status: 200,
          headers: {
            'Content-Type': 'text/html; charset=utf-8',
            ETag: '"index-html-v1"'
          }
        })
    } as any
  }

  // realApp already imported

  const resRoot = await realApp.fetch(new Request('http://localhost/'), htmlEnv)
  assert.equal(resRoot.status, 200)
  assert.equal(resRoot.headers.get('Cache-Control'), 'public, max-age=0, must-revalidate')
  assert.equal(resRoot.headers.get('Vary'), null, 'HTML response without Origin must not carry Vary: Origin')

  const linkHeader = resRoot.headers.get('Link') || ''
  assert.ok(linkHeader.includes('</assets/BPn1yCOv.css>; rel=preload; as=style'), 'Link must preload primary stylesheet')
  assert.ok(
    linkHeader.includes('</assets/ClP0DXXT.woff2>; rel=preload; as=font; type=font/woff2; crossorigin'),
    'Link must preload first critical woff2 font'
  )
  assert.ok(
    linkHeader.includes('</assets/CM4MMJ-t.woff2>; rel=preload; as=font; type=font/woff2; crossorigin'),
    'Link must preload second critical woff2 font'
  )
  assert.ok(!linkHeader.includes('extra-font.woff2'), 'Link hints must be capped at 3 total')
  assert.ok(!linkHeader.includes('XKyaHtl9.js'), 'Link hints must not preload modulepreload scripts')
  assert.ok(!linkHeader.includes('fetchpriority'), 'Font Link hints must not include fetchpriority')
  assert.equal(await resRoot.text(), mockHtml, 'HTML body must remain untouched')

  // SPA route with cached ETag also emits the same Early Hints and bfcache-safe Cache-Control
  const resFaq = await realApp.fetch(new Request('http://localhost/faq'), htmlEnv)
  assert.equal(resFaq.status, 200)
  assert.equal(resFaq.headers.get('Cache-Control'), 'public, max-age=0, must-revalidate')
  assert.equal(resFaq.headers.get('Link'), linkHeader)
  assert.equal(await resFaq.text(), mockHtml)
})

test('Media edge cache security: non-public/auth-gated media uses private, no-store and never leaks to unauthenticated cache hits', async () => {
  const { sqlite, env } = setupTestEnv()
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS Services (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      image_url TEXT,
      is_active INTEGER NOT NULL DEFAULT 1
    );
  `)
  sqlite.prepare('INSERT INTO Media_Storage (file_key, chunk_index, content_type, data, created_at) VALUES (?, ?, ?, ?, ?)').run(
    'hidden-secret.webp', 0, 'image/webp', Buffer.from('0123456789abcdefghij'), '2026-01-01T00:00:00Z'
  )
  sqlite.prepare('INSERT INTO Portfolio_Images (media_key, is_active) VALUES (?, ?)').run('hidden-secret.webp', 0)

  const originalCachesDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'caches')
  const cacheStore = new Map<string, Response>()
  let cachePutCount = 0
  let cacheMatchCount = 0
  Object.defineProperty(globalThis, 'caches', {
    configurable: true,
    value: {
      default: {
        match: async (req: Request) => {
          cacheMatchCount++
          const hit = cacheStore.get(req.url)
          return hit ? hit.clone() : undefined
        },
        put: async (req: Request, res: Response) => {
          cachePutCount++
          cacheStore.set(req.url, res.clone())
        }
      }
    }
  })

  try {
    // realApp already imported
    const secret = await getMediaSigningSecret(env)
    const { exp, sig } = await signMediaKey('hidden-secret.webp', secret!, 60)

    // 1. Signed URL access for is_active = 0 returns 200/206/304 with private, no-store and never touches caches.default
    const signed200 = await realApp.fetch(
      new Request(`http://localhost/api/media/hidden-secret.webp?exp=${exp}&sig=${sig}`),
      env
    )
    assert.equal(signed200.status, 200)
    assert.equal(signed200.headers.get('Cache-Control'), 'private, no-store')
    const etag = signed200.headers.get('ETag')!

    const signed206 = await realApp.fetch(
      new Request(`http://localhost/api/media/hidden-secret.webp?exp=${exp}&sig=${sig}`, {
        headers: { Range: 'bytes=0-4' }
      }),
      env
    )
    assert.equal(signed206.status, 206)
    assert.equal(signed206.headers.get('Cache-Control'), 'private, no-store')

    const signed304 = await realApp.fetch(
      new Request(`http://localhost/api/media/hidden-secret.webp?exp=${exp}&sig=${sig}`, {
        headers: { 'If-None-Match': etag }
      }),
      env
    )
    assert.equal(signed304.status, 304)
    assert.equal(signed304.headers.get('Cache-Control'), 'private, no-store')

    // 2. Admin Bearer / Cookie access for is_active = 0 returns private, no-store and never populates caches.default
    const adminToken = await createSessionToken(getSigningSecret(env)!, env.ADMIN_EMAIL!)
    const adminRes = await realApp.fetch(
      new Request('http://localhost/api/media/hidden-secret.webp', {
        headers: {
          Authorization: `Bearer ${adminToken}`,
          Cookie: `admin_session=${adminToken}`
        }
      }),
      env
    )
    assert.equal(adminRes.status, 200)
    assert.equal(adminRes.headers.get('Cache-Control'), 'private, no-store')
    assert.equal(cachePutCount, 0, 'Non-public/auth-gated media must never write to caches.default')
    assert.equal(cacheMatchCount, 0, 'Non-public/auth-gated media must never read from caches.default')

    // 3. Subsequent unauthenticated request for is_active = 0 is still rejected (302)
    const unauthRes = await realApp.fetch(
      new Request('http://localhost/api/media/hidden-secret.webp'),
      env
    )
    assert.equal(unauthRes.status, 302)
  } finally {
    if (originalCachesDescriptor) {
      Object.defineProperty(globalThis, 'caches', originalCachesDescriptor)
    } else {
      delete (globalThis as any).caches
    }
  }
})

test('Public is_active = 1 media with ?v= serves immutable Cache-Control, preserves v+w in cache key, and /api/portfolio appends ?v=', async () => {
  const { sqlite, env } = setupTestEnv()
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS Services (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      image_url TEXT,
      is_active INTEGER NOT NULL DEFAULT 1
    );
  `)
  sqlite.prepare("INSERT INTO Admin_Settings (setting_key, setting_value) VALUES ('public_cache_version', '7')").run()
  sqlite.prepare('INSERT INTO Media_Storage (file_key, chunk_index, content_type, data, created_at) VALUES (?, ?, ?, ?, ?)').run(
    'public-photo.webp', 0, 'image/webp', Buffer.from('public-original'), '2026-01-01T00:00:00Z'
  )
  sqlite.prepare('INSERT INTO Media_Storage (file_key, chunk_index, content_type, data, created_at) VALUES (?, ?, ?, ?, ?)').run(
    'public-photo.webp__w640', 0, 'image/webp', Buffer.from('public-w640'), '2026-01-01T00:00:00Z'
  )
  sqlite.prepare('INSERT INTO Portfolio_Images (media_key, section, category, display_order, is_active) VALUES (?, ?, ?, ?, ?)').run(
    'public-photo.webp', 'gallery', 'Portrait', 1, 1
  )
  sqlite.prepare('INSERT INTO Portfolio_Images (media_key, section, category, display_order, is_active) VALUES (?, ?, ?, ?, ?)').run(
    'https://cdn.example.com/external.webp', 'gallery', 'Portrait', 2, 1
  )

  const originalCachesDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'caches')
  const cacheStore = new Map<string, Response>()
  Object.defineProperty(globalThis, 'caches', {
    configurable: true,
    value: {
      default: {
        match: async (req: Request) => {
          const hit = cacheStore.get(req.url)
          return hit ? hit.clone() : undefined
        },
        put: async (req: Request, res: Response) => {
          cacheStore.set(req.url, res.clone())
        }
      }
    }
  })

  try {
    // realApp already imported

    // 1. /api/portfolio appends ?v=7 to internal /api/media/ URLs and leaves external URLs untouched
    const portfolioRes = await realApp.fetch(new Request('http://localhost/api/portfolio'), env)
    assert.equal(portfolioRes.status, 200)
    const portfolioJson = (await portfolioRes.json()) as { images: Array<{ media_key: string; url: string }> }
    const internalImg = portfolioJson.images.find((i) => i.media_key === 'public-photo.webp')
    const externalImg = portfolioJson.images.find((i) => i.media_key === 'https://cdn.example.com/external.webp')
    assert.equal(internalImg?.url, '/api/media/public-photo.webp?v=7')
    assert.equal(externalImg?.url, 'https://cdn.example.com/external.webp')

    // 2. Public ?v=7&w=640 media serves immutable Cache-Control and preserves v and w in cache key
    const resVersioned = await realApp.fetch(
      new Request('http://localhost/api/media/public-photo.webp?v=7&w=640'),
      env
    )
    assert.equal(resVersioned.status, 200)
    assert.equal(resVersioned.headers.get('Cache-Control'), 'public, max-age=31536000, immutable')
    assert.equal(await resVersioned.text(), 'public-w640')

    const mediaCacheKeys = Array.from(cacheStore.keys()).filter((k) => k.includes('/api/media/public-photo.webp'))
    assert.equal(mediaCacheKeys.length, 1)
    const parsedKey = new URL(mediaCacheKeys[0])
    assert.equal(parsedKey.searchParams.get('v'), '7')
    assert.equal(parsedKey.searchParams.get('w'), '640')
    assert.equal(parsedKey.searchParams.get('__cv'), '7')

    // 3. Unversioned public media keeps safe 1h/24h SWR Cache-Control
    const resUnversioned = await realApp.fetch(
      new Request('http://localhost/api/media/public-photo.webp'),
      env
    )
    assert.equal(resUnversioned.status, 200)
    assert.equal(
      resUnversioned.headers.get('Cache-Control'),
      'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800'
    )
  } finally {
    if (originalCachesDescriptor) {
      Object.defineProperty(globalThis, 'caches', originalCachesDescriptor)
    } else {
      delete (globalThis as any).caches
    }
  }
})

test('/admin/assets/* serves immutable Cache-Control when ?v= is present and no-store when unversioned or HTML', async () => {
  const { env } = setupTestEnv()
  const adminEnv: Bindings = {
    ...env,
    ASSETS: {
      fetch: async (input: RequestInfo | URL) => {
        const reqUrl = new URL(typeof input === 'string' ? input : input instanceof Request ? input.url : input.toString())
        if (reqUrl.pathname === '/admin/' || reqUrl.pathname === '/admin/index.html') {
          return new Response('<!DOCTYPE html><html></html>', {
            status: 200,
            headers: { 'Content-Type': 'text/html; charset=utf-8' }
          })
        }
        if (reqUrl.pathname.endsWith('.css')) {
          return new Response('body{color:#000}', {
            status: 200,
            headers: { 'Content-Type': 'text/css; charset=utf-8' }
          })
        }
        if (reqUrl.pathname.endsWith('.js')) {
          return new Response('console.log(1);', {
            status: 200,
            headers: { 'Content-Type': 'application/javascript; charset=utf-8' }
          })
        }
        return new Response('Not found', { status: 404 })
      }
    }
  }

  // realApp already imported

  // GET /admin keeps 301 redirect to /admin/
  const redirectRes = await realApp.fetch(new Request('http://localhost/admin'), adminEnv)
  assert.equal(redirectRes.status, 301)
  assert.equal(redirectRes.headers.get('Location'), '/admin/')

  // /admin/ HTML keeps no-store even if ?v= is passed
  const htmlRes = await realApp.fetch(new Request('http://localhost/admin/?v=abc12345'), adminEnv)
  assert.equal(htmlRes.status, 200)
  assert.equal(htmlRes.headers.get('Cache-Control'), 'no-store, no-cache, must-revalidate')

  // Versioned CSS and JS assets receive immutable Cache-Control
  const cssVersioned = await realApp.fetch(new Request('http://localhost/admin/assets/css/admin-bundle.css?v=deadbeef'), adminEnv)
  assert.equal(cssVersioned.status, 200)
  assert.equal(cssVersioned.headers.get('Cache-Control'), 'public, max-age=31536000, immutable')

  const jsVersioned = await realApp.fetch(new Request('http://localhost/admin/assets/js/admin-boot.js?v=cafebabe'), adminEnv)
  assert.equal(jsVersioned.status, 200)
  assert.equal(jsVersioned.headers.get('Cache-Control'), 'public, max-age=31536000, immutable')

  // Unversioned or blank ?v= CSS and JS assets keep no-store
  const cssUnversioned = await realApp.fetch(new Request('http://localhost/admin/assets/css/admin-bundle.css'), adminEnv)
  assert.equal(cssUnversioned.status, 200)
  assert.equal(cssUnversioned.headers.get('Cache-Control'), 'no-store, no-cache, must-revalidate')

  const jsEmptyV = await realApp.fetch(new Request('http://localhost/admin/assets/js/theme-init.js?v=%20%20'), adminEnv)
  assert.equal(jsEmptyV.status, 200)
  assert.equal(jsEmptyV.headers.get('Cache-Control'), 'no-store, no-cache, must-revalidate')
})
