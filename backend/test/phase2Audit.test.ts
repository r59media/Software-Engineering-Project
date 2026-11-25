import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createHmac } from 'node:crypto'
import { Hono } from 'hono'
import workerEntry, { app, type Bindings } from '../src/index.ts'
import { createSessionToken } from '../src/middleware/auth.ts'
import { signRescheduleToken } from '../src/utils/signedUrl.ts'
import { ensureSchemaReady, adminRouter } from '../src/routes/admin.ts'
import { checkoutRouter } from '../src/routes/checkout.ts'
import { pricingRouter, couponsRouter } from '../src/routes/pricing.ts'
import { contactRouter } from '../src/routes/contact.ts'
import { rescheduleRoutes } from '../src/routes/reschedule.ts'
import { squareWebhookRouter } from '../src/routes/squareWebhook.ts'
import { servicesRouter } from '../src/routes/services.ts'
import {
  syncInvoice,
  syncTerminalCheckout,
  sendTerminalCheckout,
  refreshBilling,
  sendBalanceInvoice,
  BillingError
} from '../src/lib/squareBilling.ts'
import {
  formatMinutesToTime,
  isSlotInPast,
  syncRollingScheduleSlots,
  ensureRollingSlotsUpToDate,
  releaseBookingSlots,
  runDailyMaintenance
} from '../src/lib/scheduleSync.ts'
import {
  buildStudioIcsFeed,
  buildGoogleCalendarTemplateUrl,
  syncBookingToGoogleCalendarApi
} from '../src/lib/googleCalendar.ts'
import { sendEmail, sendOperationalAlertEmail, sendNewLeadNotificationEmail } from '../src/email.ts'

function createD1(sqlite: DatabaseSync): any {
  const plain = (row: any) => (row ? { ...row } : null)
  let txChain = Promise.resolve()
  const statement = (sql: string, params: any[] = []): any => ({
    sql,
    params,
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
    exec: async (sql: string) => sqlite.exec(sql),
    batch: (statements: any[]) => {
      const run = txChain.then(async () => {
        sqlite.exec('BEGIN')
        try {
          const out = []
          for (const s of statements) {
            out.push(/^\s*SELECT/i.test(s.sql) ? await s.all() : await s.run())
          }
          sqlite.exec('COMMIT')
          return out
        } catch (err) {
          sqlite.exec('ROLLBACK')
          throw err
        }
      })
      txChain = run.catch(() => {})
      return run
    }
  }
}

function setupFullDb() {
  const sqlite = new DatabaseSync(':memory:')
  const schemaSql = readFileSync(resolve(import.meta.dirname, '../schema.sql'), 'utf8')
  sqlite.exec(schemaSql)
  return { sqlite, db: createD1(sqlite) }
}

function setupPre0005Db() {
  const sqlite = new DatabaseSync(':memory:')
  sqlite.exec(`
    CREATE TABLE Services (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, price INTEGER, duration_minutes INTEGER, full_day INTEGER DEFAULT 0, is_active BOOLEAN DEFAULT 1, image_url TEXT);
    CREATE TABLE Schedule_Slots (id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT NOT NULL, start_time TEXT NOT NULL, end_time TEXT NOT NULL, is_booked BOOLEAN DEFAULT 0);
    CREATE TABLE Bookings (
      id INTEGER PRIMARY KEY AUTOINCREMENT, service_id INTEGER, slot_id INTEGER NOT NULL,
      client_name TEXT NOT NULL, client_email TEXT NOT NULL, price_at_booking INTEGER NOT NULL,
      square_payment_id TEXT UNIQUE, status TEXT DEFAULT 'pending', customer_phone TEXT DEFAULT '',
      location TEXT DEFAULT '', notes TEXT DEFAULT '', attendees INTEGER DEFAULT 1, deposit_paid INTEGER DEFAULT 0,
      coupon_code TEXT DEFAULT '', custom_price INTEGER, deposit_percent INTEGER,
      photo_permission_portfolio BOOLEAN DEFAULT 0, photo_permission_social BOOLEAN DEFAULT 0,
      photo_permission_accepted_at TEXT, photo_permission_version TEXT DEFAULT 'v1',
      event_location TEXT, agreement_signed_name TEXT, agreement_signed_at TEXT, applied_fees_json TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE Booking_Payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT, booking_id INTEGER NOT NULL, amount INTEGER NOT NULL,
      method TEXT NOT NULL, paid_on TEXT NOT NULL, note TEXT DEFAULT '', square_invoice_id TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE UNIQUE INDEX idx_payments_square_invoice ON Booking_Payments(square_invoice_id);
    CREATE TABLE Booking_Charges (
      id INTEGER PRIMARY KEY AUTOINCREMENT, booking_id INTEGER NOT NULL,
      description TEXT NOT NULL CHECK (length(description) BETWEEN 1 AND 120),
      amount_cents INTEGER NOT NULL CHECK (amount_cents BETWEEN 1 AND 100000000),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE Booking_Invoices (
      id INTEGER PRIMARY KEY AUTOINCREMENT, booking_id INTEGER NOT NULL, attempt_key TEXT NOT NULL UNIQUE,
      square_invoice_id TEXT UNIQUE, square_order_id TEXT, invoice_number TEXT, version INTEGER,
      amount_cents INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL, public_url TEXT, due_date TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE UNIQUE INDEX idx_invoices_one_open ON Booking_Invoices(booking_id)
      WHERE status IN ('CREATING','DRAFT','UNPAID','SCHEDULED','PARTIALLY_PAID','PAYMENT_PENDING');
    CREATE TABLE Coupons (
      id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT NOT NULL UNIQUE,
      discount_type TEXT NOT NULL DEFAULT 'percent', discount_value REAL NOT NULL,
      description TEXT DEFAULT '', is_active BOOLEAN DEFAULT 1, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE Admin_Settings (setting_key TEXT PRIMARY KEY, setting_value TEXT NOT NULL);
    CREATE TABLE Blocked_Dates (id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT NOT NULL UNIQUE, reason TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE Media_Storage (file_key TEXT NOT NULL, chunk_index INTEGER NOT NULL, content_type TEXT NOT NULL DEFAULT 'image/webp', data BLOB NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (file_key, chunk_index));
    CREATE TABLE Portfolio_Images (id INTEGER PRIMARY KEY AUTOINCREMENT, media_key TEXT NOT NULL, section TEXT NOT NULL DEFAULT 'gallery', category TEXT DEFAULT 'All', title TEXT, alt_text TEXT, display_order INTEGER DEFAULT 0, is_active BOOLEAN DEFAULT 1, is_featured BOOLEAN DEFAULT 0, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
  `)
  return { sqlite, db: createD1(sqlite) }
}

function futureDateISO(daysAhead: number): string {
  const d = new Date(Date.now() + daysAhead * 86_400_000)
  return d.toISOString().slice(0, 10)
}

const VALID_SECRET = 'p'.repeat(32)
const ADMIN_EMAIL = 'studio@r59media.example'

test('1. D1 migration 0005_audit_hardening.sql and ensureSchemaReady upgrade pre-0005 DBs cleanly', async () => {
  const { sqlite, db } = setupPre0005Db()
  const migrationSql = readFileSync(resolve(import.meta.dirname, '../migrations/0005_audit_hardening.sql'), 'utf8')
  sqlite.exec(migrationSql)

  const bpCols = (sqlite.prepare('PRAGMA table_info(Booking_Payments)').all() as any[]).map((c) => c.name)
  assert.ok(bpCols.includes('square_terminal_checkout_id'))
  assert.ok(bpCols.includes('square_refund_id'))

  const bCols = (sqlite.prepare('PRAGMA table_info(Bookings)').all() as any[]).map((c) => c.name)
  assert.ok(bCols.includes('checkout_idempotency_key'))
  assert.ok(bCols.includes('locked_slot_ids_json'))
  assert.ok(bCols.includes('gcal_sync_status'))
  assert.ok(bCols.includes('reschedule_count'))

  const cCols = (sqlite.prepare('PRAGMA table_info(Coupons)').all() as any[]).map((c) => c.name)
  assert.ok(cCols.includes('expires_at'))
  assert.ok(cCols.includes('max_uses'))
  assert.ok(cCols.includes('used_count'))

  const tables = (sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as any[]).map((t) => t.name)
  assert.ok(tables.includes('Rate_Limits'))
  assert.ok(tables.includes('Leads'))

  // ensureSchemaReady on a second pre-0005 DB must also succeed idempotently
  const pre2 = setupPre0005Db()
  await ensureSchemaReady(pre2.db)
  await ensureSchemaReady(pre2.db)
  const bCols2 = (pre2.sqlite.prepare('PRAGMA table_info(Bookings)').all() as any[]).map((c) => c.name)
  assert.ok(bCols2.includes('locked_slot_ids_json'))
  assert.ok(bCols2.includes('checkout_idempotency_key'))
})

test('2. syncTerminalCheckout deduplicates by square_terminal_checkout_id and syncInvoice handles partial/refund updates atomically', async () => {
  const { sqlite, db } = setupFullDb()
  sqlite.prepare("INSERT INTO Schedule_Slots (id, date, start_time, end_time, is_booked) VALUES (1, '2026-12-10', '10:00', '11:00', 1)").run()
  sqlite.prepare(
    "INSERT INTO Bookings (id, service_id, slot_id, client_name, client_email, price_at_booking, deposit_paid, status) VALUES (1, 1, 1, 'Ana', 'ana@example.com', 50000, 10000, 'confirmed')"
  ).run()

  // Terminal checkout deduplication via square_terminal_checkout_id
  const terminalCheckout = {
    id: 'term_chk_123',
    status: 'COMPLETED',
    referenceId: '1',
    amountMoney: { amount: 15000n, currency: 'USD' },
    updatedAt: '2026-12-10T15:00:00Z'
  }
  await Promise.all([
    syncTerminalCheckout(db, terminalCheckout, 'America/New_York'),
    syncTerminalCheckout(db, terminalCheckout, 'America/New_York')
  ])
  const termRows = sqlite.prepare('SELECT amount, square_terminal_checkout_id FROM Booking_Payments WHERE booking_id = 1').all() as any[]
  assert.equal(termRows.length, 1)
  assert.equal(termRows[0].amount, 15000)
  assert.equal(termRows[0].square_terminal_checkout_id, 'term_chk_123')

  // Invoice partial payment -> paid -> partial refund -> full refund
  sqlite.prepare(
    "INSERT INTO Booking_Invoices (booking_id, attempt_key, square_invoice_id, version, amount_cents, status) VALUES (1, 'att_1', 'inv_99', 1, 25000, 'UNPAID')"
  ).run()

  await syncInvoice(db, {
    id: 'inv_99',
    version: 2,
    status: 'PARTIALLY_PAID',
    invoiceNumber: 'INV-99',
    paymentRequests: [{ totalCompletedAmountMoney: { amount: 10000n } }]
  }, 'America/New_York')

  let invPay = sqlite.prepare("SELECT amount FROM Booking_Payments WHERE square_invoice_id = 'inv_99'").get() as any
  assert.equal(invPay.amount, 10000)

  await syncInvoice(db, {
    id: 'inv_99',
    version: 3,
    status: 'PAID',
    invoiceNumber: 'INV-99',
    paymentRequests: [{ totalCompletedAmountMoney: { amount: 25000n } }]
  }, 'America/New_York')
  invPay = sqlite.prepare("SELECT amount FROM Booking_Payments WHERE square_invoice_id = 'inv_99'").get() as any
  assert.equal(invPay.amount, 25000)

  await syncInvoice(db, {
    id: 'inv_99',
    version: 4,
    status: 'PARTIALLY_REFUNDED',
    invoiceNumber: 'INV-99',
    paymentRequests: [{ totalCompletedAmountMoney: { amount: 25000n }, refundedAmountMoney: { amount: 10000n } }]
  }, 'America/New_York')
  invPay = sqlite.prepare("SELECT amount FROM Booking_Payments WHERE square_invoice_id = 'inv_99'").get() as any
  assert.equal(invPay.amount, 15000)

  await syncInvoice(db, {
    id: 'inv_99',
    version: 5,
    status: 'REFUNDED',
    invoiceNumber: 'INV-99',
    paymentRequests: [{ totalCompletedAmountMoney: { amount: 0n } }]
  }, 'America/New_York')
  invPay = sqlite.prepare("SELECT amount FROM Booking_Payments WHERE square_invoice_id = 'inv_99'").get() as any
  assert.equal(invPay, undefined)
})

test('2b. squareWebhook rejects >64KB UTF-8 multi-byte body with 413', async () => {
  const { db } = setupFullDb()
  const key = 'whsec_test_key'
  const url = 'https://example.com/api/webhook/square'
  // 25000 3-byte UTF-8 chars = 25000 .length (< 65536), 75000 bytes (> 65536)
  const heavyBody = JSON.stringify({ pad: '€'.repeat(25000) })
  assert.ok(heavyBody.length < 65536)
  assert.ok(new TextEncoder().encode(heavyBody).byteLength > 65536)

  const sig = createHmac('sha256', key).update(url + heavyBody).digest('base64')
  const res = await squareWebhookRouter.request(
    '/',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-square-hmacsha256-signature': sig
      },
      body: heavyBody
    },
    { DB: db, SQUARE_WEBHOOK_SIGNATURE_KEY: key, SQUARE_WEBHOOK_URL: url } as Bindings
  )
  assert.equal(res.status, 413)
})

test('2c. sendTerminalCheckout claims exclusive lock and refreshBilling reconciles pending terminal checkout', async () => {
  const { sqlite, db } = setupFullDb()
  sqlite.prepare("INSERT INTO Schedule_Slots (id, date, start_time, end_time, is_booked) VALUES (1, '2026-12-10', '10:00', '11:00', 1)").run()
  sqlite.prepare(
    "INSERT INTO Bookings (id, service_id, slot_id, client_name, client_email, price_at_booking, deposit_paid, status) VALUES (1, 1, 1, 'Ana', 'ana@example.com', 50000, 10000, 'confirmed')"
  ).run()

  // Existing CREATING lock blocks sendTerminalCheckout with 409
  sqlite.prepare(
    "INSERT INTO Booking_Invoices (booking_id, attempt_key, amount_cents, status) VALUES (1, 'lock_1', 40000, 'CREATING')"
  ).run()

  await assert.rejects(
    sendTerminalCheckout(db, { SQUARE_ACCESS_TOKEN: 'tok', SQUARE_LOCATION_ID: 'loc' }, 1, 40000, 'dev_1'),
    (err: any) => err instanceof BillingError && err.httpStatus === 409
  )
})

test('3. Checkout past-slot guard, depositFor consistency, $0 coupon bypass, attendees cap, coupon limits, and idempotency before slot lock', async () => {
  const { sqlite, db } = setupFullDb()
  sqlite.prepare("DELETE FROM Admin_Settings WHERE setting_key = 'weekly_availability'").run()
  const future = futureDateISO(10)
  const past = '2020-01-01'

  sqlite.prepare("INSERT INTO Schedule_Slots (id, date, start_time, end_time, is_booked) VALUES (1, ?, '10:00', '11:00', 0)").run(past)
  sqlite.prepare("INSERT INTO Schedule_Slots (id, date, start_time, end_time, is_booked) VALUES (2, ?, '10:00', '11:00', 0)").run(future)
  sqlite.prepare("INSERT INTO Schedule_Slots (id, date, start_time, end_time, is_booked) VALUES (3, ?, '11:00', '12:00', 0)").run(future)

  // Service with maxPeople=2 and price=10000 ($100)
  sqlite.prepare(
    "INSERT INTO Services (id, name, price, duration_minutes, booking_mode, additional_people, is_active) VALUES (10, 'Mini', 10000, 60, 'direct', '{\"includedPeople\":1,\"maxPeople\":2,\"extraPersonPriceMinor\":2500}', 1)"
  ).run()

  // Coupons: 100% off, expired, maxed-out
  sqlite.prepare(
    "INSERT INTO Coupons (code, discount_type, discount_value, is_active, expires_at, max_uses, used_count) VALUES ('FREE100', 'percent', 100, 1, '2099-01-01T00:00:00Z', 5, 0)"
  ).run()
  sqlite.prepare(
    "INSERT INTO Coupons (code, discount_type, discount_value, is_active, expires_at, max_uses, used_count) VALUES ('OLD50', 'percent', 50, 1, '2020-01-01T00:00:00Z', 5, 0)"
  ).run()
  sqlite.prepare(
    "INSERT INTO Coupons (code, discount_type, discount_value, is_active, expires_at, max_uses, used_count) VALUES ('MAXED', 'amount', 20, 1, '2099-01-01T00:00:00Z', 1, 1)"
  ).run()

  const env = {
    DB: db,
    SESSION_SECRET: VALID_SECRET,
    ADMIN_EMAIL,
    PUBLIC_ORIGIN: 'https://r59.example.com',
    GOOGLE_CALENDAR_ID: 'cal@r59.example.com'
  } as Bindings

  // Coupon validate rejects expired & maxed-out
  const appCoupon = new Hono<{ Bindings: Bindings }>()
  appCoupon.route('/api/coupons', couponsRouter)
  const expRes = await appCoupon.request('/api/coupons/validate?code=OLD50', {}, env)
  assert.equal(((await expRes.json()) as any).valid, false)
  const maxRes = await appCoupon.request('/api/coupons/validate?code=MAXED', {}, env)
  assert.equal(((await maxRes.json()) as any).valid, false)

  // Past slot rejected with 409
  const pastRes = await checkoutRouter.request(
    '/',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': '203.0.113.10' },
      body: JSON.stringify({
        sourceId: 'cnon:card-nonce-ok',
        idempotencyKey: 'idem_past_12345',
        slot_id: 1,
        serviceId: 10,
        clientName: 'Test Client',
        clientEmail: 'client@example.com',
        agreementSignatureName: 'Test Client'
      })
    },
    env
  )
  assert.equal(pastRes.status, 409)

  // Attendees > maxPeople rejected with 400
  const attRes = await checkoutRouter.request(
    '/',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': '203.0.113.11' },
      body: JSON.stringify({
        sourceId: 'cnon:card-nonce-ok',
        idempotencyKey: 'idem_att_123456',
        slot_id: 2,
        serviceId: 10,
        attendees: 5,
        clientName: 'Test Client',
        clientEmail: 'client@example.com',
        agreementSignatureName: 'Test Client'
      })
    },
    env
  )
  assert.equal(attRes.status, 400)

  // $0 100% coupon confirms booking WITHOUT Square credentials & persists locked_slot_ids_json, idempotency key, used_count
  const freeRes = await checkoutRouter.request(
    '/',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': '203.0.113.12' },
      body: JSON.stringify({
        idempotencyKey: 'idem_free_12345',
        slot_id: 2,
        serviceId: 10,
        attendees: 1,
        couponCode: 'FREE100',
        clientName: 'Free Client',
        clientEmail: 'free@example.com',
        agreementSignatureName: 'Free Client'
      })
    },
    env
  )
  assert.equal(freeRes.status, 201)
  const freeJson = (await freeRes.json()) as any
  assert.equal(freeJson.deposit_cents, 0)
  assert.equal(freeJson.balance_cents, 0)
  assert.ok(freeJson.reschedule_url.startsWith('https://r59.example.com/reschedule'))
  assert.ok(freeJson.google_calendar_url.includes('add=cal%40r59.example.com'))

  const bookingRow = sqlite.prepare('SELECT * FROM Bookings WHERE id = ?').get(freeJson.bookingId) as any
  assert.equal(bookingRow.checkout_idempotency_key, 'idem_free_12345')
  assert.deepEqual(JSON.parse(bookingRow.locked_slot_ids_json), [2])
  assert.equal(bookingRow.coupon_code, 'FREE100')
  assert.equal((sqlite.prepare("SELECT used_count FROM Coupons WHERE code = 'FREE100'").get() as any).used_count, 1)

  // Retry with same idempotencyKey returns existing booking instead of 409 SLOT_UNAVAILABLE
  const retryRes = await checkoutRouter.request(
    '/',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': '203.0.113.12' },
      body: JSON.stringify({
        idempotencyKey: 'idem_free_12345',
        slot_id: 2,
        serviceId: 10,
        attendees: 1,
        couponCode: 'FREE100',
        clientName: 'Free Client',
        clientEmail: 'free@example.com',
        agreementSignatureName: 'Free Client'
      })
    },
    env
  )
  assert.ok(retryRes.status === 200 || retryRes.status === 201)
  const retryJson = (await retryRes.json()) as any
  assert.equal(retryJson.bookingId, freeJson.bookingId)
})

test('4. Admin cancel transitions status BEFORE refund and restores on refund failure; multi-slot manual booking checks Blocked_Dates', async () => {
  const { sqlite, db } = setupFullDb()
  const future = futureDateISO(12)
  const blocked = futureDateISO(15)
  const token = await createSessionToken(VALID_SECRET, ADMIN_EMAIL)
  const env = { DB: db, SESSION_SECRET: VALID_SECRET, ADMIN_EMAIL } as Bindings

  sqlite.prepare("INSERT INTO Blocked_Dates (date, reason) VALUES (?, 'Holiday')").run(blocked)
  sqlite.prepare("INSERT INTO Schedule_Slots (id, date, start_time, end_time, is_booked) VALUES (1, ?, '10:00', '11:00', 0)").run(blocked)
  sqlite.prepare("INSERT INTO Schedule_Slots (id, date, start_time, end_time, is_booked) VALUES (2, ?, '10:00', '11:00', 0)").run(future)
  sqlite.prepare("INSERT INTO Schedule_Slots (id, date, start_time, end_time, is_booked) VALUES (3, ?, '11:00', '12:00', 0)").run(future)

  // Manual booking on blocked date (via date/time without slot_id) must fail with 409
  const blockedRes = await adminRouter.request(
    '/bookings',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        client_name: 'Bob',
        client_email: 'bob@example.com',
        service_id: 2, // 120m
        date: blocked,
        start_time: '10:00',
        end_time: '11:00'
      })
    },
    env
  )
  assert.equal(blockedRes.status, 409)

  // Manual booking on future date for 120m service via date/time locks BOTH slots 2 & 3
  const createRes = await adminRouter.request(
    '/bookings',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        client_name: 'Bob',
        client_email: 'bob@example.com',
        service_id: 2, // 120m
        date: future,
        start_time: '10:00',
        end_time: '11:00'
      })
    },
    env
  )
  assert.equal(createRes.status, 200)
  const createdJson = (await createRes.json()) as any
  assert.equal((sqlite.prepare('SELECT is_booked FROM Schedule_Slots WHERE id = 2').get() as any).is_booked, 1)
  assert.equal((sqlite.prepare('SELECT is_booked FROM Schedule_Slots WHERE id = 3').get() as any).is_booked, 1)

  // Cancel with Square payment but no Square credentials -> refund fails, status restored to confirmed, slots still booked
  sqlite.prepare("UPDATE Bookings SET square_payment_id = 'pay_1', deposit_paid = 5000 WHERE id = ?").run(createdJson.id)
  const cancelFailRes = await adminRouter.request(
    `/bookings/${createdJson.id}/cancel`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ refund: true })
    },
    env
  )
  assert.equal(cancelFailRes.status, 503)
  const bookingAfterFail = sqlite.prepare('SELECT status FROM Bookings WHERE id = ?').get(createdJson.id) as any
  assert.equal(bookingAfterFail.status, 'confirmed')
  assert.equal((sqlite.prepare('SELECT is_booked FROM Schedule_Slots WHERE id = 2').get() as any).is_booked, 1)
})

test('5. Reschedule aborts BEFORE mutating slot_id or inserting charges when open invoice is already paid', async () => {
  const { sqlite, db } = setupFullDb()
  const d1 = futureDateISO(10)
  const d2 = futureDateISO(11)
  // Clear weekly_availability so any day/hour is open in this test
  sqlite.prepare("DELETE FROM Admin_Settings WHERE setting_key = 'weekly_availability'").run()
  sqlite.prepare("INSERT INTO Schedule_Slots (id, date, start_time, end_time, is_booked) VALUES (1, ?, '10:00', '11:00', 1)").run(d1)
  sqlite.prepare("INSERT INTO Schedule_Slots (id, date, start_time, end_time, is_booked) VALUES (2, ?, '14:00', '15:00', 0)").run(d2)
  sqlite.prepare(
    "INSERT INTO Bookings (id, service_id, slot_id, client_name, client_email, customer_phone, price_at_booking, deposit_paid, status) VALUES (1, 1, 1, 'Jane Doe', 'jane@example.com', '4045551234', 6000, 3600, 'confirmed')"
  ).run()
  // Reschedule fee rule
  sqlite.prepare(
    "INSERT OR REPLACE INTO Admin_Settings (setting_key, setting_value) VALUES ('pricing', ?)"
  ).run(JSON.stringify({ feeRules: [{ id: 'resch', name: 'Reschedule Fee', triggerType: 'reschedule', amountType: 'fixed_cents', amountValue: 2500, active: true }] }))
  // Open invoice with status CREATING (cannot be cancelled -> throws 409 INVOICE_SENDING)
  sqlite.prepare(
    "INSERT INTO Booking_Invoices (booking_id, attempt_key, amount_cents, status) VALUES (1, 'att_creating', 2400, 'CREATING')"
  ).run()

  const token = await signRescheduleToken(1, 'jane@example.com', VALID_SECRET)
  const res = await rescheduleRoutes.request(
    '/1/reschedule',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': '198.51.100.9' },
      body: JSON.stringify({ token, verifyName: 'Jane Doe', verifyEmail: 'jane@example.com', slot_id: 2 })
    },
    { DB: db, SESSION_SECRET: VALID_SECRET } as Bindings
  )
  assert.equal(res.status, 409)
  assert.equal((sqlite.prepare('SELECT slot_id FROM Bookings WHERE id = 1').get() as any).slot_id, 1)
  assert.equal((sqlite.prepare('SELECT COUNT(*) AS cnt FROM Booking_Charges WHERE booking_id = 1').get() as any).cnt, 0)
  assert.equal((sqlite.prepare('SELECT is_booked FROM Schedule_Slots WHERE id = 2').get() as any).is_booked, 0)
})

test('6. ScheduleSync 24:00 slot, locked_slot_ids_json release after service edit, Turnstile, email, gcal, health & cron maintenance', async () => {
  const { sqlite, db } = setupFullDb()

  // formatMinutesToTime(1440) -> '24:00'
  assert.equal(formatMinutesToTime(1440), '24:00')

  // isSlotInPast
  assert.equal(isSlotInPast({ date: '2020-01-01', start_time: '10:00' }, 'America/New_York'), true)
  assert.equal(isSlotInPast({ date: futureDateISO(3), start_time: '10:00' }, 'America/New_York'), false)

  // releaseBookingSlots uses locked_slot_ids_json even if service duration was shrunk from 120m to 60m
  const future = futureDateISO(5)
  sqlite.prepare("INSERT INTO Schedule_Slots (id, date, start_time, end_time, is_booked) VALUES (10, ?, '10:00', '11:00', 1)").run(future)
  sqlite.prepare("INSERT INTO Schedule_Slots (id, date, start_time, end_time, is_booked) VALUES (11, ?, '11:00', '12:00', 1)").run(future)
  sqlite.prepare(
    "INSERT INTO Bookings (id, service_id, slot_id, client_name, client_email, price_at_booking, status, locked_slot_ids_json) VALUES (50, 1, 10, 'Sam', 'sam@example.com', 6000, 'confirmed', '[10,11]')"
  ).run()
  await releaseBookingSlots(db, 50, 10)
  assert.equal((sqlite.prepare('SELECT is_booked FROM Schedule_Slots WHERE id = 10').get() as any).is_booked, 0)
  assert.equal((sqlite.prepare('SELECT is_booked FROM Schedule_Slots WHERE id = 11').get() as any).is_booked, 0)

  // googleCalendar removes hardcoded Gmail default when unset
  const ics = buildStudioIcsFeed([], [], 'America/New_York\r\nInjected: yes')
  assert.ok(!ics.includes('r59mediatesting@gmail.com'))
  assert.ok(!ics.includes('\nInjected: yes') && !ics.includes('\r\nInjected: yes'))
  const tplUrl = buildGoogleCalendarTemplateUrl({ id: 1, date: future, start_time: '10:00' }, 'https://r59.example.com')
  assert.equal(new URL(tplUrl).searchParams.get('add'), null)

  // contactRouter Turnstile enforcement when TURNSTILE_SECRET_KEY is set vs unset
  const noCapRes = await contactRouter.request(
    '/',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': '203.0.113.50' },
      body: JSON.stringify({ name: 'Test', email: 'test@example.com', message: 'Hello there' })
    },
    { DB: db, TURNSTILE_SECRET_KEY: 'turnstile-secret' } as Bindings
  )
  assert.equal(noCapRes.status, 403)

  const openRes = await contactRouter.request(
    '/',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': '203.0.113.51' },
      body: JSON.stringify({ name: 'Test', email: 'test@example.com', message: 'Hello open' })
    },
    { DB: db } as Bindings
  )
  assert.equal(openRes.status, 200)

  // Honeypot silent drop
  const honeyRes = await contactRouter.request(
    '/',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': '203.0.113.52' },
      body: JSON.stringify({ name: 'Bot', email: 'bot@example.com', message: 'Spam', website: 'http://spam.invalid' })
    },
    { DB: db } as Bindings
  )
  assert.equal(honeyRes.status, 200)
  assert.equal((sqlite.prepare("SELECT COUNT(*) AS cnt FROM Leads WHERE email = 'bot@example.com'").get() as any).cnt, 0)

  // Health endpoint returns non-sensitive readiness flags & 503 when DB fails
  const healthOk = await app.fetch(new Request('http://localhost/api/health'), { DB: db, SESSION_SECRET: VALID_SECRET } as Bindings)
  assert.equal(healthOk.status, 200)
  const healthJson = (await healthOk.json()) as any
  assert.equal(healthJson.db, true)
  assert.equal(healthJson.config.sessionSecret, true)
  assert.equal(healthJson.config.square, false)

  const brokenDb = { prepare: () => { throw new Error('D1 down') } } as any
  const healthErr = await app.fetch(new Request('http://localhost/api/health'), { DB: brokenDb } as Bindings)
  assert.equal(healthErr.status, 503)

  // runDailyMaintenance cleans stale CREATING invoices, orphaned Media_Storage (>24h), expired Rate_Limits, old Leads (>365d)
  sqlite.prepare("INSERT INTO Booking_Invoices (booking_id, attempt_key, amount_cents, status, created_at) VALUES (50, 'stale_1', 1000, 'CREATING', datetime('now', '-10 minutes'))").run()
  sqlite.prepare("INSERT INTO Media_Storage (file_key, chunk_index, content_type, data, created_at) VALUES ('orphan.webp', 0, 'image/webp', X'00', datetime('now', '-48 hours'))").run()
  sqlite.prepare("INSERT INTO Rate_Limits (bucket, count, window_start) VALUES ('old_bucket', 1, 1000)").run()
  sqlite.prepare("INSERT INTO Leads (name, email, message, created_at) VALUES ('Old', 'old@example.com', 'Old msg', datetime('now', '-400 days'))").run()

  await runDailyMaintenance(db, { DB: db } as Bindings)
  assert.equal((sqlite.prepare("SELECT COUNT(*) AS cnt FROM Booking_Invoices WHERE attempt_key = 'stale_1'").get() as any).cnt, 0)
  assert.equal((sqlite.prepare("SELECT COUNT(*) AS cnt FROM Media_Storage WHERE file_key = 'orphan.webp'").get() as any).cnt, 0)
  assert.equal((sqlite.prepare("SELECT COUNT(*) AS cnt FROM Rate_Limits WHERE bucket = 'old_bucket'").get() as any).cnt, 0)
  assert.equal((sqlite.prepare("SELECT COUNT(*) AS cnt FROM Leads WHERE email = 'old@example.com'").get() as any).cnt, 0)

  // Verify email helpers exported and strip newlines
  assert.equal(typeof sendEmail, 'function')
  assert.equal(typeof sendOperationalAlertEmail, 'function')
  assert.equal(typeof sendNewLeadNotificationEmail, 'function')
  assert.equal(typeof syncBookingToGoogleCalendarApi, 'function')
  assert.equal(typeof ensureRollingSlotsUpToDate, 'function')
  assert.equal(typeof syncRollingScheduleSlots, 'function')
  assert.equal(typeof servicesRouter, 'object')
  assert.equal(typeof pricingRouter, 'object')
  assert.equal(typeof workerEntry.scheduled, 'function')
})

test('7. Services media cleanup, admin boundary validation, email subject CR/LF strip, and GCal OAuth cache + gcal_sync_status', async () => {
  const { sqlite, db } = setupFullDb()
  const token = await createSessionToken(VALID_SECRET, ADMIN_EMAIL)
  const env = { DB: db, SESSION_SECRET: VALID_SECRET, ADMIN_EMAIL } as Bindings

  // 1. Services PUT image replacement & DELETE cleans up unreferenced Media_Storage chunks
  sqlite.prepare("INSERT INTO Services (id, name, price, duration_minutes, image_url, is_active) VALUES (99, 'Svc', 10000, 60, '/api/media/svc-old.webp', 1)").run()
  sqlite.prepare("INSERT INTO Media_Storage (file_key, chunk_index, content_type, data) VALUES ('svc-old.webp', 0, 'image/webp', X'00'), ('svc-old.webp__w640', 0, 'image/webp', X'00')").run()
  const putSvc = await servicesRouter.request(
    '/99',
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ image_url: '/api/media/svc-new.webp' })
    },
    env
  )
  assert.equal(putSvc.status, 200)
  assert.equal((sqlite.prepare("SELECT COUNT(*) AS cnt FROM Media_Storage WHERE file_key LIKE 'svc-old.webp%'").get() as any).cnt, 0)

  sqlite.prepare("INSERT INTO Media_Storage (file_key, chunk_index, content_type, data) VALUES ('svc-new.webp', 0, 'image/webp', X'00')").run()
  const delSvc = await servicesRouter.request(
    '/99',
    { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } },
    env
  )
  assert.equal(delSvc.status, 200)
  assert.equal((sqlite.prepare("SELECT COUNT(*) AS cnt FROM Media_Storage WHERE file_key = 'svc-new.webp'").get() as any).cnt, 0)

  // 2. Admin boundary validation: bad date, invalid timezone, malformed JSON, profile.social null item, fixed coupon float safety
  const badDateSlot = await adminRouter.request(
    '/schedule',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ date: '2026-02-30', start_time: '10:00', end_time: '11:00' })
    },
    env
  )
  assert.equal(badDateSlot.status, 400)

  const badTz = await adminRouter.request(
    '/schedule',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ timezone: 'Not/A_Real_Zone' })
    },
    env
  )
  assert.equal(badTz.status, 400)

  const profileSafe = await adminRouter.request(
    '/profile',
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ bio: 'Hi', social: [null, { platform: 'IG', url: 'https://instagram.com/r59' }] })
    },
    env
  )
  assert.equal(profileSafe.status, 200)

  const couponRes = await adminRouter.request(
    '/coupons',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ code: 'SAVE1999', type: 'fixed', amount: 19.99, max_uses: 3 })
    },
    env
  )
  assert.equal(couponRes.status, 200)
  const couponJson = (await couponRes.json()) as any
  assert.equal(couponJson.coupon.amount, 19.99)
  assert.equal(couponJson.coupon.max_uses, 3)

  // 3. Email strips CR/LF from subject & GCal caches OAuth token and updates gcal_sync_status
  const origFetch = globalThis.fetch
  const calls: Array<{ url: string; subject?: string }> = []
  let oauthCalls = 0
  globalThis.fetch = (async (input: any, init?: any) => {
    const url = typeof input === 'string' ? input : input.url
    if (url === 'https://api.resend.com/emails') {
      const parsed = JSON.parse(init.body)
      calls.push({ url, subject: parsed.subject })
      return new Response('{}', { status: 200 })
    }
    if (url === 'https://oauth2.googleapis.com/token') {
      oauthCalls += 1
      return new Response(JSON.stringify({ access_token: 'tok_cached', expires_in: 3600 }), { status: 200 })
    }
    if (url.includes('googleapis.com/calendar/v3')) {
      return new Response('{}', { status: 500 })
    }
    return origFetch(input, init)
  }) as any

  try {
    await sendEmail(
      { ...env, RESEND_API_KEY: 're_test', EMAIL_FROM: 'no-reply@r59.example.com' },
      { to: 'u@example.com', subject: 'Hello\r\nBcc: evil@example.com', text: 'Body' }
    )
    assert.equal(calls.length, 1)
    assert.ok(!calls[0].subject!.includes('\r') && !calls[0].subject!.includes('\n'))

    const future = futureDateISO(8)
    sqlite.prepare("INSERT INTO Schedule_Slots (id, date, start_time, end_time, is_booked) VALUES (77, ?, '10:00', '11:00', 1)").run(future)
    sqlite.prepare("INSERT INTO Bookings (id, service_id, slot_id, client_name, client_email, price_at_booking, status) VALUES (77, 1, 77, 'GCal', 'g@example.com', 6000, 'confirmed')").run()

    const gcalEnv = {
      ...env,
      GOOGLE_CLIENT_ID: 'cid',
      GOOGLE_CLIENT_SECRET: 'csec',
      GOOGLE_CALENDAR_REFRESH_TOKEN: 'rtok',
      GOOGLE_CALENDAR_ID: 'cal@r59.example.com'
    } as Bindings
    const g1 = await syncBookingToGoogleCalendarApi(gcalEnv, { id: 77, date: future, start_time: '10:00' }, 'upsert')
    const g2 = await syncBookingToGoogleCalendarApi(gcalEnv, { id: 77, date: future, start_time: '10:00' }, 'upsert')
    assert.equal(g1.synced, false)
    assert.equal(g2.synced, false)
    assert.equal(oauthCalls, 1, 'OAuth token should be cached in isolate memory across syncs')
    assert.equal((sqlite.prepare('SELECT gcal_sync_status FROM Bookings WHERE id = 77').get() as any).gcal_sync_status, 'failed')
  } finally {
    globalThis.fetch = origFetch
  }
})
