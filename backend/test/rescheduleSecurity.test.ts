import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import realApp, { type Bindings } from '../src/index.ts'
import { BOOKING_PAYMENTS_TABLE_SQL, BILLING_SCHEMA_STEPS } from '../src/lib/billingSchema.ts'
import { signCalendarFeedToken, signRescheduleToken } from '../src/utils/signedUrl.ts'

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

function setupRescheduleDb() {
  const sqlite = new DatabaseSync(':memory:')
  sqlite.exec(`
    CREATE TABLE Services (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, price INTEGER, duration_minutes INTEGER DEFAULT 60, full_day INTEGER DEFAULT 0);
    CREATE TABLE Schedule_Slots (id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT NOT NULL, start_time TEXT NOT NULL, end_time TEXT NOT NULL, is_booked INTEGER DEFAULT 0);
    CREATE TABLE Blocked_Dates (id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT NOT NULL UNIQUE, reason TEXT);
    CREATE TABLE Bookings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      service_id INTEGER,
      slot_id INTEGER,
      client_name TEXT NOT NULL,
      client_email TEXT NOT NULL,
      customer_phone TEXT DEFAULT '',
      location TEXT DEFAULT '',
      event_location TEXT,
      notes TEXT DEFAULT '',
      attendees INTEGER DEFAULT 1,
      price_at_booking INTEGER NOT NULL,
      deposit_paid INTEGER DEFAULT 0,
      custom_price INTEGER,
      deposit_percent INTEGER,
      status TEXT DEFAULT 'confirmed',
      locked_slot_ids_json TEXT,
      reschedule_count INTEGER DEFAULT 0,
      gcal_sync_status TEXT
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

  const d1 = getFutureDate(14)
  const d2 = getFutureDate(21)
  sqlite.exec(`
    INSERT INTO Admin_Settings (setting_key, setting_value) VALUES ('timezone', 'America/New_York');
    INSERT INTO Admin_Settings (setting_key, setting_value) VALUES ('calendar_feed_version', '2');
    INSERT INTO Admin_Settings (setting_key, setting_value) VALUES ('pricing', '{"policy":{"rescheduleCutoffDays":2},"feeRules":[{"id":"resched_fee","name":"Reschedule Fee","triggerType":"reschedule","amountType":"fixed_cents","amountValue":2500,"active":true}]}');
    INSERT INTO Services (id, name, price, duration_minutes) VALUES (1, 'Portrait', 20000, 60);
  `)
  sqlite.prepare("INSERT INTO Schedule_Slots (id, date, start_time, end_time, is_booked) VALUES (1, ?, '10:00', '11:00', 1)").run(d1)
  sqlite.prepare("INSERT INTO Schedule_Slots (id, date, start_time, end_time, is_booked) VALUES (2, ?, '12:00', '13:00', 0)").run(d2)
  sqlite.prepare("INSERT INTO Schedule_Slots (id, date, start_time, end_time, is_booked) VALUES (3, ?, '14:00', '15:00', 0)").run(d2)
  sqlite.prepare(
    "INSERT INTO Bookings (id, service_id, slot_id, client_name, client_email, customer_phone, price_at_booking, deposit_paid, status) VALUES (1, 1, 1, 'Elena', 'elena@example.com', '555-0100', 20000, 10000, 'confirmed')"
  ).run()
  sqlite.prepare(
    "INSERT INTO Bookings (id, service_id, slot_id, client_name, client_email, customer_phone, price_at_booking, deposit_paid, status) VALUES (2, 1, 3, 'Cancelled User', 'cancelled@example.com', '555-0199', 20000, 10000, 'cancelled')"
  ).run()

  const env: Bindings = {
    DB: createD1(sqlite),
    SESSION_SECRET: 'r'.repeat(32),
    ADMIN_EMAIL: 'admin@r59media.com',
    SQUARE_ACCESS_TOKEN: 'sq-tok',
    SQUARE_LOCATION_ID: 'LOC_1',
    SQUARE_ENVIRONMENT: 'sandbox'
  }
  return { sqlite, env }
}

test('Reschedule security: expired token -> 401, rotated calendar_feed_version -> 401, cancelled ICS -> 409, and Cache-Control: no-store on all responses', async () => {
  const { env } = setupRescheduleDb()
  const secret = env.SESSION_SECRET!

  const expiredTok = await signRescheduleToken(1, 'elena@example.com', secret, {
    expSeconds: Math.floor(Date.now() / 1000) - 10
  })

  // 1. Expired token -> 401 on GET /:id/reschedule, POST /:id/reschedule, POST /reschedule/unlock, GET /:id/calendar.ics
  const rGet = await realApp.fetch(new Request(`http://localhost/api/bookings/1/reschedule?token=${expiredTok}`), env)
  assert.equal(rGet.status, 401)
  assert.equal(rGet.headers.get('Cache-Control'), 'no-store')

  const rPost = await realApp.fetch(
    new Request('http://localhost/api/bookings/1/reschedule', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': '203.0.113.1' },
      body: JSON.stringify({ token: expiredTok, slot_id: 2, verifyName: 'Elena', verifyEmail: 'elena@example.com' })
    }),
    env
  )
  assert.equal(rPost.status, 401)
  assert.equal(rPost.headers.get('Cache-Control'), 'no-store')

  const rUnlock = await realApp.fetch(
    new Request('http://localhost/api/bookings/reschedule/unlock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': '203.0.113.2' },
      body: JSON.stringify({ bookingId: 1, token: expiredTok, name: 'Elena', email: 'elena@example.com' })
    }),
    env
  )
  assert.equal(rUnlock.status, 401)
  assert.equal(rUnlock.headers.get('Cache-Control'), 'no-store')

  const rIcsExpired = await realApp.fetch(new Request(`http://localhost/api/bookings/1/calendar.ics?token=${expiredTok}`), env)
  assert.equal(rIcsExpired.status, 401)
  assert.equal(rIcsExpired.headers.get('Cache-Control'), 'no-store')

  // 2. Rotated calendar_feed_version (DB is '2') rejects v1 feed token with 401 + no-store
  const oldFeedTok = await signCalendarFeedToken(secret, '1')
  const rFeedOld = await realApp.fetch(new Request(`http://localhost/api/bookings/calendar.ics?token=${oldFeedTok}`), env)
  assert.equal(rFeedOld.status, 401)
  assert.equal(rFeedOld.headers.get('Cache-Control'), 'no-store')

  const currentFeedTok = await signCalendarFeedToken(secret, '2')
  const rFeedOk = await realApp.fetch(new Request(`http://localhost/api/bookings/calendar.ics?token=${currentFeedTok}`), env)
  assert.equal(rFeedOk.status, 200)
  assert.equal(rFeedOk.headers.get('Cache-Control'), 'no-store')

  // 3. Cancelled booking GET /api/bookings/:id/calendar.ics -> 409 + no-store
  const cancelTok = await signRescheduleToken(2, 'cancelled@example.com', secret)
  const rCancelledIcs = await realApp.fetch(new Request(`http://localhost/api/bookings/2/calendar.ics?token=${cancelTok}`), env)
  assert.equal(rCancelledIcs.status, 409)
  assert.equal(rCancelledIcs.headers.get('Cache-Control'), 'no-store')
})

test('POST /api/bookings/:id/reschedule aborts without moving slot or adding fee when cancelOpenInvoice fails (INVOICE_ALREADY_PAID / INVOICE_PAYMENT_PENDING)', async () => {
  const { sqlite, env } = setupRescheduleDb()
  const token = await signRescheduleToken(1, 'elena@example.com', env.SESSION_SECRET!)

  sqlite.prepare(
    "INSERT INTO Booking_Invoices (booking_id, attempt_key, square_invoice_id, version, amount_cents, status) VALUES (1, 'att_res_1', 'inv_res_1', 1, 10000, 'UNPAID')"
  ).run()

  const origFetch = globalThis.fetch
  let squareInvoiceStatus = 'PAID'

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/v2/invoices/inv_res_1')) {
      return new Response(
        JSON.stringify({
          invoice: {
            id: 'inv_res_1',
            version: 2,
            status: squareInvoiceStatus,
            payment_requests: [{ total_completed_amount_money: { amount: 10000, currency: 'USD' } }]
          }
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    }
    return new Response(JSON.stringify({}), { status: 404 })
  }) as typeof fetch

  try {
    for (const [idx, invStatus, expectedCode] of [
      [1, 'PAID', 'INVOICE_ALREADY_PAID'],
      [2, 'PAYMENT_PENDING', 'INVOICE_PAYMENT_PENDING']
    ] as const) {
      squareInvoiceStatus = invStatus
      // Re-open local row so cancelOpenInvoice inspects Square again on second case
      sqlite.exec("UPDATE Booking_Invoices SET status = 'UNPAID', version = 1 WHERE square_invoice_id = 'inv_res_1'")

      const res = await realApp.fetch(
        new Request('http://localhost/api/bookings/1/reschedule', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': `203.0.113.${20 + idx}` },
          body: JSON.stringify({
            token,
            slot_id: 2,
            verifyName: 'Elena',
            verifyEmail: 'elena@example.com'
          })
        }),
        env
      )
      assert.equal(res.status, 409)
      assert.equal(res.headers.get('Cache-Control'), 'no-store')
      const json = (await res.json()) as any
      assert.equal(json.error.code, expectedCode)

      // Slot must NOT have moved and NO reschedule fee charge may be inserted
      const bookingRow = sqlite.prepare('SELECT slot_id, reschedule_count FROM Bookings WHERE id = 1').get() as any
      assert.equal(bookingRow.slot_id, 1)
      assert.equal(bookingRow.reschedule_count, 0)
      assert.equal((sqlite.prepare('SELECT is_booked FROM Schedule_Slots WHERE id = 2').get() as any).is_booked, 0)
      assert.equal((sqlite.prepare('SELECT COUNT(*) AS cnt FROM Booking_Charges').get() as any).cnt, 0)
    }
  } finally {
    globalThis.fetch = origFetch
  }
})
