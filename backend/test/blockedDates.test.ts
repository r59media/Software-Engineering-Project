import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import { createSessionToken } from '../src/middleware/auth.ts'

function loadAdminRouter() {
  const req = createRequire(import.meta.url)
  const esbuild = createRequire(req.resolve('wrangler'))('esbuild')
  const out = esbuild.buildSync({
    entryPoints: [fileURLToPath(new URL('../src/routes/admin.ts', import.meta.url))],
    bundle: true,
    write: false,
    format: 'cjs',
    platform: 'node',
    packages: 'external'
  })
  const mod = { exports: {} as any }
  new Function('require', 'exports', 'module', out.outputFiles[0].text)(req, mod.exports, mod)
  return mod.exports.adminRouter || mod.exports.default
}

function createD1(sqlite: DatabaseSync): any {
  const plain = (row: any) => (row ? { ...row } : null)
  const statement = (sql: string, params: any[] = []): any => ({
    sql,
    bind: (...values: any[]) => statement(sql, values),
    first: async (column?: string) => {
      const row = plain(sqlite.prepare(sql).get(...params))
      return row && column ? row[column] : row
    },
    all: async () => ({
      success: true,
      results: sqlite.prepare(sql).all(...params).map(plain),
      meta: {}
    }),
    run: async () => {
      const info = sqlite.prepare(sql).run(...params)
      return {
        success: true,
        results: [],
        meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) }
      }
    }
  })
  return {
    prepare: (sql: string) => statement(sql),
    exec: async (sql: string) => sqlite.exec(sql)
  }
}

async function setup() {
  const sqlite = new DatabaseSync(':memory:')
  sqlite.exec(`
    CREATE TABLE Blocked_Dates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL UNIQUE,
      reason TEXT
    );
    CREATE TABLE revoked_tokens (
      token_hash TEXT PRIMARY KEY,
      expires_at INTEGER
    );
    CREATE TABLE Site_Settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `)
  const signingSecret = 'test-admin-signing-secret-123456'
  const adminEmail = 'admin@r59media.com'
  const token = await createSessionToken(signingSecret, adminEmail)
  const env = {
    DB: createD1(sqlite),
    ADMIN_EMAIL: adminEmail,
    SESSION_SECRET: signingSecret
  } as any
  return { sqlite, token, env }
}

async function postBlockedDates(adminRouter: any, env: any, token: string, body: Record<string, unknown>) {
  return adminRouter.request(
    '/blocked-dates',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify(body)
    },
    env
  )
}

test('POST /admin/blocked-dates supports single-date, range, and rejects invalid ranges', async () => {
  const adminRouter = loadAdminRouter()
  const { sqlite, token, env } = await setup()

  // 1. Single-date request remains backwards-compatible
  const singleRes = await postBlockedDates(adminRouter, env, token, {
    date: '2026-12-24',
    reason: 'Christmas Eve'
  })
  assert.equal(singleRes.status, 200)
  const singleJson: any = await singleRes.json()
  assert.equal(singleJson.success, true)
  assert.equal(singleJson.status, 'success')
  assert.equal(singleJson.date, '2026-12-24')
  assert.equal(singleJson.dateStr, '2026-12-24')
  assert.equal(singleJson.reason, 'Christmas Eve')
  assert.equal(singleJson.data.date, '2026-12-24')
  assert.equal(singleJson.count, 1)
  assert.equal(singleJson.blockedDates.length, 1)

  // 2. Date range inserts missing dates, preserves existing ones, and sorts ASC
  const rangeRes = await postBlockedDates(adminRouter, env, token, {
    date: '2026-12-24',
    endDate: '2026-12-26',
    reason: 'Holiday Break'
  })
  assert.equal(rangeRes.status, 200)
  const rangeJson: any = await rangeRes.json()
  assert.equal(rangeJson.success, true)
  assert.equal(rangeJson.count, 3)
  assert.deepEqual(
    rangeJson.blockedDates.map((d: any) => d.date),
    ['2026-12-24', '2026-12-25', '2026-12-26']
  )
  assert.equal(rangeJson.blockedDates[0].reason, 'Christmas Eve')
  assert.equal(rangeJson.blockedDates[1].reason, 'Holiday Break')
  assert.equal(rangeJson.blockedDates[2].reason, 'Holiday Break')
  const countRow = sqlite.prepare('SELECT COUNT(*) AS cnt FROM Blocked_Dates').get() as { cnt: number }
  assert.equal(countRow.cnt, 3)

  // 3. Invalid range (endDate < date) returns 400 VALIDATION_FAILED
  const invalidRes = await postBlockedDates(adminRouter, env, token, {
    date: '2026-12-26',
    endDate: '2026-12-24',
    reason: 'Backwards'
  })
  assert.equal(invalidRes.status, 400)
  const invalidJson: any = await invalidRes.json()
  assert.equal(invalidJson.error.code, 'VALIDATION_FAILED')

  // 4. Range > 90 days returns 400 VALIDATION_FAILED
  const tooLongRes = await postBlockedDates(adminRouter, env, token, {
    date: '2026-01-01',
    endDate: '2026-04-02',
    reason: 'Too Long'
  })
  assert.equal(tooLongRes.status, 400)
  const tooLongJson: any = await tooLongRes.json()
  assert.equal(tooLongJson.error.code, 'VALIDATION_FAILED')
})
