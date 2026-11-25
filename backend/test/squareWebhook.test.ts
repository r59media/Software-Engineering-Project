import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import realApp, { type Bindings } from '../src/index.ts'
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

function setupWebhookDb() {
  const sqlite = new DatabaseSync(':memory:')
  sqlite.exec(`
    CREATE TABLE Services (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, price INTEGER);
    CREATE TABLE Schedule_Slots (id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT NOT NULL, start_time TEXT, end_time TEXT);
    CREATE TABLE Bookings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      service_id INTEGER,
      slot_id INTEGER,
      client_name TEXT NOT NULL,
      client_email TEXT NOT NULL,
      price_at_booking INTEGER NOT NULL,
      status TEXT DEFAULT 'confirmed',
      deposit_paid INTEGER DEFAULT 0,
      custom_price INTEGER,
      deposit_percent INTEGER
    );
    CREATE TABLE Admin_Settings (setting_key TEXT PRIMARY KEY, setting_value TEXT NOT NULL);
  `)
  sqlite.exec(BOOKING_PAYMENTS_TABLE_SQL)
  for (const step of BILLING_SCHEMA_STEPS) {
    try {
      sqlite.exec(step.sql)
    } catch (err) {
      if (!step.ignoreError) throw err
    }
  }
  sqlite.exec(`
    INSERT INTO Services (id, name, price) VALUES (1, 'Portrait', 50000);
    INSERT INTO Schedule_Slots (id, date, start_time, end_time) VALUES (1, '2026-12-20', '10:00', '11:00');
    INSERT INTO Bookings (id, service_id, slot_id, client_name, client_email, price_at_booking, deposit_paid)
      VALUES (1, 1, 1, 'Ana', 'ana@example.com', 50000, 30000);
    INSERT INTO Booking_Invoices (booking_id, attempt_key, square_invoice_id, version, amount_cents, status)
      VALUES (1, 'att_wh_1', 'inv_wh_1', 1, 20000, 'UNPAID');
    INSERT INTO Admin_Settings (setting_key, setting_value) VALUES ('timezone', 'America/New_York');
  `)

  const webhookUrl = 'https://r59media.com/api/square/webhook'
  const webhookKey = 'whsec_test_key_123456'
  const env: Bindings = {
    DB: createD1(sqlite),
    SESSION_SECRET: 's'.repeat(32),
    SQUARE_WEBHOOK_SIGNATURE_KEY: webhookKey,
    SQUARE_WEBHOOK_URL: webhookUrl,
    SQUARE_ACCESS_TOKEN: 'sq-tok',
    SQUARE_LOCATION_ID: 'LOC_1',
    SQUARE_ENVIRONMENT: 'sandbox'
  }
  return { sqlite, env, webhookUrl, webhookKey }
}

function signWebhook(url: string, key: string, rawBody: string): string {
  return createHmac('sha256', key).update(url + rawBody).digest('base64')
}

test('Square webhook rejects unconfigured (503), oversized UTF-8 (413), and bad HMAC (401) on both endpoints', async () => {
  const { env, webhookUrl, webhookKey } = setupWebhookDb()

  // 503 when unconfigured
  for (const path of ['/api/square/webhook', '/api/webhook/square']) {
    const res503 = await realApp.fetch(
      new Request(`http://localhost${path}`, { method: 'POST', body: '{}' }),
      { DB: env.DB } as Bindings
    )
    assert.equal(res503.status, 503)
  }

  // 413 on oversized multi-byte UTF-8 payload without Content-Length header
  const bigBody = JSON.stringify({ event_id: 'evt_big', data: '😀'.repeat(20000) })
  const bigRes = await realApp.fetch(
    new Request('http://localhost/api/square/webhook', {
      method: 'POST',
      headers: { 'x-square-hmacsha256-signature': signWebhook(webhookUrl, webhookKey, bigBody) },
      body: bigBody
    }),
    env
  )
  assert.equal(bigRes.status, 413)

  // 401 on invalid HMAC
  const res401 = await realApp.fetch(
    new Request('http://localhost/api/webhook/square', {
      method: 'POST',
      headers: { 'x-square-hmacsha256-signature': 'invalid-sig' },
      body: JSON.stringify({ event_id: 'evt_1', type: 'invoice.payment_made' })
    }),
    env
  )
  assert.equal(res401.status, 401)
})

test('Square webhook returns 200 ignored on unhandled event and unknown invoice', async () => {
  const { env, webhookUrl, webhookKey } = setupWebhookDb()

  const unhandledBody = JSON.stringify({ event_id: 'evt_unk_type', type: 'customer.created' })
  const res1 = await realApp.fetch(
    new Request('http://localhost/api/square/webhook', {
      method: 'POST',
      headers: { 'x-square-hmacsha256-signature': signWebhook(webhookUrl, webhookKey, unhandledBody) },
      body: unhandledBody
    }),
    env
  )
  assert.equal(res1.status, 200)
  assert.deepEqual(await res1.json(), { received: true, ignored: true })

  const unknownInvBody = JSON.stringify({
    event_id: 'evt_unk_inv',
    type: 'invoice.payment_made',
    data: { object: { invoice: { id: 'inv_does_not_exist' } } }
  })
  const res2 = await realApp.fetch(
    new Request('http://localhost/api/webhook/square', {
      method: 'POST',
      headers: { 'x-square-hmacsha256-signature': signWebhook(webhookUrl, webhookKey, unknownInvBody) },
      body: unknownInvBody
    }),
    env
  )
  assert.equal(res2.status, 200)
  assert.deepEqual(await res2.json(), { received: true, ignored: true })
})

test('Square webhook reconciles PAID -> PARTIALLY_REFUNDED -> REFUNDED net amounts and PARTIALLY_PAID', async () => {
  const { sqlite, env, webhookUrl, webhookKey } = setupWebhookDb()
  const origFetch = globalThis.fetch
  let currentSquareInvoice: any = null

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/v2/invoices/inv_wh_1')) {
      return new Response(JSON.stringify({ invoice: currentSquareInvoice }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    }
    return new Response(JSON.stringify({}), { status: 404 })
  }) as typeof fetch

  try {
    const postEvent = (type: string) => {
      const body = JSON.stringify({
        event_id: `evt_${type}_${Date.now()}`,
        type,
        data: { object: { invoice: { id: 'inv_wh_1' } } }
      })
      return realApp.fetch(
        new Request('http://localhost/api/square/webhook', {
          method: 'POST',
          headers: { 'x-square-hmacsha256-signature': signWebhook(webhookUrl, webhookKey, body) },
          body
        }),
        env
      )
    }

    // 1. PARTIALLY_PAID (5000 cents)
    currentSquareInvoice = {
      id: 'inv_wh_1',
      version: 2,
      status: 'PARTIALLY_PAID',
      invoice_number: '00099',
      updated_at: '2026-11-20T15:00:00Z',
      payment_requests: [{ total_completed_amount_money: { amount: 5000, currency: 'USD' } }]
    }
    assert.equal((await postEvent('invoice.payment_made')).status, 200)
    assert.equal((sqlite.prepare("SELECT amount FROM Booking_Payments WHERE square_invoice_id = 'inv_wh_1'").get() as any).amount, 5000)

    // 2. PAID (20000 cents)
    currentSquareInvoice = {
      id: 'inv_wh_1',
      version: 3,
      status: 'PAID',
      invoice_number: '00099',
      updated_at: '2026-11-20T16:00:00Z',
      payment_requests: [{ total_completed_amount_money: { amount: 20000, currency: 'USD' } }]
    }
    assert.equal((await postEvent('invoice.payment_made')).status, 200)
    assert.equal((sqlite.prepare("SELECT amount FROM Booking_Payments WHERE square_invoice_id = 'inv_wh_1'").get() as any).amount, 20000)

    // 3. PARTIALLY_REFUNDED (5000 refunded -> net 15000)
    currentSquareInvoice = {
      id: 'inv_wh_1',
      version: 4,
      status: 'PARTIALLY_REFUNDED',
      invoice_number: '00099',
      updated_at: '2026-11-21T16:00:00Z',
      payment_requests: [
        {
          total_completed_amount_money: { amount: 20000, currency: 'USD' },
          refunded_amount_money: { amount: 5000, currency: 'USD' }
        }
      ]
    }
    assert.equal((await postEvent('invoice.updated')).status, 200)
    assert.equal((sqlite.prepare("SELECT amount FROM Booking_Payments WHERE square_invoice_id = 'inv_wh_1'").get() as any).amount, 15000)

    // 4. REFUNDED (20000 refunded -> net 0 -> payment row removed)
    currentSquareInvoice = {
      id: 'inv_wh_1',
      version: 5,
      status: 'REFUNDED',
      invoice_number: '00099',
      updated_at: '2026-11-22T16:00:00Z',
      payment_requests: [
        {
          total_completed_amount_money: { amount: 20000, currency: 'USD' },
          refunded_amount_money: { amount: 20000, currency: 'USD' }
        }
      ]
    }
    assert.equal((await postEvent('invoice.updated')).status, 200)
    const afterFullRefund = sqlite.prepare("SELECT * FROM Booking_Payments WHERE square_invoice_id = 'inv_wh_1'").all()
    assert.equal(afterFullRefund.length, 0)
  } finally {
    globalThis.fetch = origFetch
  }
})

test('Square webhook deduplicates duplicate terminal.checkout.updated events to exactly 1 payment row', async () => {
  const { sqlite, env, webhookUrl, webhookKey } = setupWebhookDb()
  const origFetch = globalThis.fetch

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/v2/terminals/checkouts/term_dup_1')) {
      return new Response(
        JSON.stringify({
          checkout: {
            id: 'term_dup_1',
            status: 'COMPLETED',
            reference_id: '1',
            amount_money: { amount: 20000, currency: 'USD' },
            updated_at: '2026-11-23T18:00:00Z'
          }
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    }
    return new Response(JSON.stringify({}), { status: 404 })
  }) as typeof fetch

  try {
    const eventBody = JSON.stringify({
      event_id: 'evt_term_1',
      type: 'terminal.checkout.updated',
      data: { object: { checkout: { id: 'term_dup_1' } } }
    })
    const sig = signWebhook(webhookUrl, webhookKey, eventBody)

    const r1 = await realApp.fetch(
      new Request('http://localhost/api/square/webhook', {
        method: 'POST',
        headers: { 'x-square-hmacsha256-signature': sig },
        body: eventBody
      }),
      env
    )
    const r2 = await realApp.fetch(
      new Request('http://localhost/api/webhook/square', {
        method: 'POST',
        headers: { 'x-square-hmacsha256-signature': sig },
        body: eventBody
      }),
      env
    )
    assert.equal(r1.status, 200)
    assert.equal(r2.status, 200)

    const rows = sqlite.prepare("SELECT amount, square_terminal_checkout_id FROM Booking_Payments WHERE booking_id = 1").all() as any[]
    assert.equal(rows.length, 1)
    assert.equal(rows[0].amount, 20000)
    assert.equal(rows[0].square_terminal_checkout_id, 'term_dup_1')
  } finally {
    globalThis.fetch = origFetch
  }
})
