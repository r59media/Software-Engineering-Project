import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import realApp, { type Bindings } from '../src/index.ts'
import { createSessionToken } from '../src/middleware/auth.ts'

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

function setupMediaEnv() {
  const sqlite = new DatabaseSync(':memory:')
  sqlite.exec(`
    CREATE TABLE Admin_Settings (setting_key TEXT PRIMARY KEY, setting_value TEXT NOT NULL);
    CREATE TABLE Revoked_Sessions (signature TEXT PRIMARY KEY, expires_at INTEGER NOT NULL);
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
    CREATE TABLE Services (id INTEGER PRIMARY KEY AUTOINCREMENT, image_url TEXT, is_active INTEGER DEFAULT 1);
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
  const env: Bindings = {
    DB: createD1(sqlite),
    SESSION_SECRET: 'u'.repeat(32),
    ADMIN_EMAIL: 'admin@r59media.com'
  }
  return { sqlite, env }
}

const VALID_PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4])

test('POST /api/upload-url enforces auth, MIME allowlist, 50MB limit, and sanitizes traversal filenames', async () => {
  const { env } = setupMediaEnv()
  const token = await createSessionToken(env.SESSION_SECRET!, env.ADMIN_EMAIL!)

  // 401 unauthenticated
  const unauth = await realApp.fetch(
    new Request('http://localhost/api/upload-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: 'shot.webp', contentType: 'image/webp' })
    }),
    env
  )
  assert.equal(unauth.status, 401)

  // Valid request with traversal filename -> sanitized key under portfolio/
  const valid = await realApp.fetch(
    new Request('http://localhost/api/upload-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ filename: '../../etc/passwd.jpeg', contentType: 'image/jpeg', fileSize: 1024 })
    }),
    env
  )
  assert.equal(valid.status, 200)
  const validJson = (await valid.json()) as any
  assert.equal(validJson.success, true)
  assert.ok(validJson.fileKey.startsWith('portfolio/'))
  assert.ok(validJson.fileKey.endsWith('.jpg'))
  assert.ok(!validJson.fileKey.includes('..'))
  assert.equal(validJson.uploadUrl, `/api/media/${validJson.fileKey}`)

  // Disallowed MIME -> 400
  const badMime = await realApp.fetch(
    new Request('http://localhost/api/upload-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ filename: 'xss.svg', contentType: 'image/svg+xml' })
    }),
    env
  )
  assert.equal(badMime.status, 400)

  // > 50MB -> 400 FILE_TOO_LARGE
  const tooBig = await realApp.fetch(
    new Request('http://localhost/api/upload-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ filename: 'huge.png', contentType: 'image/png', fileSize: 50 * 1024 * 1024 + 1 })
    }),
    env
  )
  assert.equal(tooBig.status, 400)
  assert.equal(((await tooBig.json()) as any).error.code, 'FILE_TOO_LARGE')
})

test('PUT /api/media/* & /api/admin/media/* block HTML/SVG/spoofed magic bytes/malformed URI and store valid images', async () => {
  const { sqlite, env } = setupMediaEnv()
  const token = await createSessionToken(env.SESSION_SECRET!, env.ADMIN_EMAIL!)

  for (const basePath of ['/api/media', '/api/admin/media']) {
    // Rejects text/html & image/svg+xml
    for (const mime of ['text/html', 'image/svg+xml']) {
      const res = await realApp.fetch(
        new Request(`http://localhost${basePath}/portfolio/evil.svg`, {
          method: 'PUT',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': mime },
          body: '<svg onload="alert(1)"/>'
        }),
        env
      )
      assert.equal(res.status, 400, `${basePath} must reject ${mime}`)
    }

    // Rejects spoofed magic bytes (declared image/png with HTML body)
    const spoof = await realApp.fetch(
      new Request(`http://localhost${basePath}/portfolio/spoof.png`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'image/png' },
        body: '<html><script>alert(1)</script></html>'
      }),
      env
    )
    assert.equal(spoof.status, 400)

    // Rejects malformed %ZZ URI
    const badUri = await realApp.fetch(
      new Request(`http://localhost${basePath}/portfolio/%ZZbad.png`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'image/png' },
        body: VALID_PNG
      }),
      env
    )
    assert.equal(badUri.status, 400)
  }

  // Valid PNG via PUT /api/admin/media/* succeeds and persists
  const okPut = await realApp.fetch(
    new Request('http://localhost/api/admin/media/portfolio/good.png?variant=640', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'image/png' },
      body: VALID_PNG
    }),
    env
  )
  assert.equal(okPut.status, 200)
  const stored = sqlite.prepare("SELECT content_type FROM Media_Storage WHERE file_key = 'portfolio/good.png__w640'").get() as any
  assert.equal(stored.content_type, 'image/png')
})

test('GET /api/media/* forces attachment+nosniff on non-allowlisted stored content-type and returns 503 on D1 failure', async () => {
  const { sqlite, env } = setupMediaEnv()
  const token = await createSessionToken(env.SESSION_SECRET!, env.ADMIN_EMAIL!)

  sqlite.prepare("INSERT INTO Media_Storage (file_key, chunk_index, content_type, data) VALUES ('legacy.svg', 0, 'image/svg+xml', ?)").run(
    Buffer.from('<svg></svg>')
  )

  const res = await realApp.fetch(
    new Request('http://localhost/api/media/legacy.svg', {
      headers: { Authorization: `Bearer ${token}` }
    }),
    env
  )
  assert.equal(res.status, 200)
  assert.equal(res.headers.get('Content-Type'), 'application/octet-stream')
  assert.equal(res.headers.get('Content-Disposition'), 'attachment')
  assert.equal(res.headers.get('X-Content-Type-Options'), 'nosniff')

  // D1 error during media chunk retrieval -> 503
  const brokenDbEnv: Bindings = {
    SESSION_SECRET: env.SESSION_SECRET,
    ADMIN_EMAIL: env.ADMIN_EMAIL,
    DB: {
      prepare: (sql: string) => {
        const stmt = {
          bind: () => stmt,
          first: async () => null,
          all: async () => {
            throw new Error('D1_STORAGE_DOWN')
          }
        }
        return stmt
      }
    } as unknown as D1Database
  }

  const res503 = await realApp.fetch(
    new Request('http://localhost/api/media/any.png', {
      headers: { Authorization: `Bearer ${token}` }
    }),
    brokenDbEnv
  )
  assert.equal(res503.status, 503)
  assert.equal(((await res503.json()) as any).code, 'SERVICE_UNAVAILABLE')
})
