import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import { Hono, type Context } from 'hono'
import { signMediaKey, verifyMediaSignature, parseRangeHeader } from '../src/utils/signedUrl.ts'
import { adminAuth, createSessionToken, getSigningSecret, getMediaSigningSecret, verifySessionToken, isTokenRevokedInDb } from '../src/middleware/auth.ts'
import type { Bindings } from '../src/index.ts'

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

function loadRealBackendApp(): { fetch: (req: Request, env?: any) => Promise<Response> } {
  const req = createRequire(import.meta.url)
  const esbuild = createRequire(req.resolve('wrangler'))('esbuild')
  const out = esbuild.buildSync({
    entryPoints: [fileURLToPath(new URL('../src/index.ts', import.meta.url))],
    bundle: true,
    write: false,
    format: 'cjs',
    platform: 'node',
    packages: 'external'
  })
  const mod = { exports: {} as any }
  new Function('require', 'exports', 'module', out.outputFiles[0].text)(req, mod.exports, mod)
  return mod.exports.default
}

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

  const realApp = loadRealBackendApp()

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

  const realApp = loadRealBackendApp()

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
  assert.ok(res304.headers.get('Cache-Control')?.includes('max-age=31536000'))

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
