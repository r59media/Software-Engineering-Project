import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import realApp, { type Bindings } from '../src/index.ts'
import {
  buildEdgeCacheKey,
  bumpPublicContentVersion,
  getPublicContentVersion,
  PUBLIC_READ_CACHE_CONTROL,
  scheduleEdgeCachePut,
  shouldBypassPublicEdgeCache,
  tryEdgeCacheMatch
} from '../src/lib/edgeCache.ts'

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

test('buildEdgeCacheKey strips sig/exp when stripAuthParams is true and preserves path, ?w=, and __cv=', () => {
  const key = buildEdgeCacheKey(
    'https://r59media.com/api/media/gallery/photo.webp?w=800&sig=abc123&exp=1700000000',
    '7',
    { stripAuthParams: true }
  )
  const parsed = new URL(key)
  assert.equal(parsed.pathname, '/api/media/gallery/photo.webp')
  assert.equal(parsed.searchParams.get('w'), '800')
  assert.equal(parsed.searchParams.get('__cv'), '7')
  assert.equal(parsed.searchParams.get('sig'), null)
  assert.equal(parsed.searchParams.get('exp'), null)

  const publicKey = buildEdgeCacheKey('https://r59media.com/api/portfolio?section=hero&limit=10', '4')
  const parsedPublic = new URL(publicKey)
  assert.equal(parsedPublic.searchParams.get('section'), 'hero')
  assert.equal(parsedPublic.searchParams.get('limit'), '10')
  assert.equal(parsedPublic.searchParams.get('__cv'), '4')
})

test('getPublicContentVersion initializes to 1 and bumpPublicContentVersion increments atomically', async () => {
  const sqlite = new DatabaseSync(':memory:')
  sqlite.exec('CREATE TABLE Admin_Settings (setting_key TEXT PRIMARY KEY, setting_value TEXT NOT NULL);')
  const db = createD1(sqlite)

  const v1 = await getPublicContentVersion(db)
  assert.equal(v1, '1')

  await bumpPublicContentVersion(db)
  const v2 = await getPublicContentVersion(db)
  assert.equal(v2, '2')

  await bumpPublicContentVersion(db)
  const v3 = await getPublicContentVersion(db)
  assert.equal(v3, '3')

  // Never throws on missing/broken DB
  const fallback = await getPublicContentVersion(undefined)
  assert.equal(fallback, '1')
  const brokenDb = { prepare: () => { throw new Error('DB_DOWN') } } as any
  assert.equal(await getPublicContentVersion(brokenDb), '1')
})

test('tryEdgeCacheMatch and scheduleEdgeCachePut no-op safely when caches is undefined', async () => {
  const hit = await tryEdgeCacheMatch('https://r59media.com/api/portfolio?__cv=1')
  assert.equal(hit, null)
  scheduleEdgeCachePut(undefined, 'https://r59media.com/api/portfolio?__cv=1', new Response('ok', { status: 200 }))
})

test('shouldBypassPublicEdgeCache detects ?preview= and Authorization header', () => {
  assert.equal(
    shouldBypassPublicEdgeCache({
      req: { query: (k) => (k === 'preview' ? '1' : undefined), header: () => undefined }
    }),
    true
  )
  assert.equal(
    shouldBypassPublicEdgeCache({
      req: { query: () => undefined, header: (k) => (k === 'Authorization' ? 'Bearer tok' : undefined) }
    }),
    true
  )
  assert.equal(
    shouldBypassPublicEdgeCache({
      req: { query: () => undefined, header: () => undefined }
    }),
    false
  )
})

test('public read routes return edge Cache-Control on normal GET and no-store on ?preview=1', async () => {
  const sqlite = new DatabaseSync(':memory:')
  sqlite.exec(`
    CREATE TABLE Admin_Settings (setting_key TEXT PRIMARY KEY, setting_value TEXT NOT NULL);
    CREATE TABLE Portfolio_Images (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      media_key TEXT NOT NULL,
      section TEXT NOT NULL DEFAULT 'gallery',
      category TEXT NOT NULL DEFAULT 'Portrait',
      title TEXT,
      alt_text TEXT,
      display_order INTEGER NOT NULL DEFAULT 0,
      is_featured INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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
  `)
  const env = { DB: createD1(sqlite), SESSION_SECRET: 'a'.repeat(32) } as Bindings
  const app = realApp

  for (const path of ['/api/profile', '/api/portfolio', '/api/services', '/api/pricing']) {
    const res = await app.fetch(new Request(`http://localhost${path}`), env)
    assert.equal(res.status, 200, `${path} should return 200`)
    assert.equal(res.headers.get('Cache-Control'), PUBLIC_READ_CACHE_CONTROL, `${path} should set public edge Cache-Control`)

    const previewRes = await app.fetch(new Request(`http://localhost${path}?preview=1`), env)
    assert.equal(previewRes.status, 200, `${path}?preview=1 should return 200`)
    assert.equal(previewRes.headers.get('Cache-Control'), 'no-store', `${path}?preview=1 should set no-store`)
  }
})
