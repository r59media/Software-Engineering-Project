import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { Hono } from 'hono'
import type { Bindings } from '../src/index.ts'
import {
  contactRouter,
  sanitizeText,
  VALID_SESSION_TYPES,
  getIdempotencyResult,
  recordIdempotencyResult
} from '../src/routes/contact.ts'

function createContactEnv(): { sqlite: DatabaseSync; env: Bindings } {
  const sqlite = new DatabaseSync(':memory:')
  const plain = (row: any) => (row ? { ...row } : null)
  const makeStmt = (sql: string, params: any[] = []): any => ({
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
    sqlite,
    env: { DB: { prepare: (sql: string) => makeStmt(sql) } as unknown as D1Database }
  }
}

const app = new Hono<{ Bindings: Bindings }>()
app.route('/api/contact', contactRouter)

test('sanitizeText strips dangerous control characters and preserves ordinary newlines', () => {
  const dirty = 'Hello\x00\x08World\r\nLine 2\tTab\x1FEnd'
  const clean = sanitizeText(dirty)
  assert.equal(clean, 'HelloWorld\r\nLine 2\tTabEnd')
  assert.ok(!clean.includes('\x00'))
  assert.ok(!clean.includes('\x1F'))
  assert.ok(clean.includes('\r\n'))
  assert.ok(clean.includes('\t'))
})

test('VALID_SESSION_TYPES includes all catalog packages and legacy tiers', () => {
  for (const tier of ['Portrait', 'Grad Pics', 'Branding Pics', 'Event', 'Business package', 'Brand', 'Creative', 'Other']) {
    assert.ok(VALID_SESSION_TYPES.includes(tier), `Missing session type: ${tier}`)
  }
})

test('Idempotency cache records and retrieves recent write results', () => {
  const key = 'test-idemp-' + Math.random().toString(36).substring(2)
  assert.equal(getIdempotencyResult(key), null)

  recordIdempotencyResult(key, 999)
  assert.equal(getIdempotencyResult(key), 999)
})

test('POST /api/contact validates real phone bounds, email format, and required fields via contactRouter', async () => {
  const { sqlite, env } = createContactEnv()

  const validPhones = ['+1 (212) 555-0148', '555-0199', '+44 20 7946 0991', '(800) 555-1212', '1234567']
  for (let i = 0; i < validPhones.length; i++) {
    const res = await app.request(
      'http://localhost/api/contact',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': `198.51.100.${i + 1}` },
        body: JSON.stringify({
          name: 'Taylor Client',
          email: `taylor${i}@example.com`,
          phone: validPhones[i],
          session_type: 'Portrait',
          message: 'Looking to book a portrait session next month.'
        })
      },
      env
    )
    assert.equal(res.status, 200, `Valid phone ${validPhones[i]} should succeed`)
  }
  assert.equal((sqlite.prepare('SELECT COUNT(*) AS cnt FROM Leads').get() as any).cnt, validPhones.length)

  const invalidPhones = ['12345', 'call me maybe', '+1 (212) 555-01480000000000']
  for (let i = 0; i < invalidPhones.length; i++) {
    const res = await app.request(
      'http://localhost/api/contact',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': `198.51.100.${50 + i}` },
        body: JSON.stringify({
          name: 'Taylor Client',
          email: 'taylor@example.com',
          phone: invalidPhones[i],
          message: 'Hello there'
        })
      },
      env
    )
    assert.equal(res.status, 400, `Invalid phone ${invalidPhones[i]} must fail with 400`)
    const json = (await res.json()) as any
    assert.equal(json.error.code, 'VALIDATION_FAILED')
    assert.ok(json.error.details.some((d: any) => d.field === 'phone'))
  }

  // Bad email and missing message
  const badRes = await app.request(
    'http://localhost/api/contact',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': '198.51.100.99' },
      body: JSON.stringify({ name: '', email: 'not-an-email', message: '' })
    },
    env
  )
  assert.equal(badRes.status, 400)
  const badJson = (await badRes.json()) as any
  const fields = badJson.error.details.map((d: any) => d.field)
  assert.ok(fields.includes('name'))
  assert.ok(fields.includes('email'))
  assert.ok(fields.includes('message'))
})
