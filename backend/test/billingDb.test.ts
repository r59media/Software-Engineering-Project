import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import realApp from '../src/index.ts'
import {
  BOOKING_PAYMENTS_TABLE_SQL,
  BILLING_SCHEMA_STEPS,
  ensurePhotoPermissionsColumns,
  replaceMediaStorageChunks
} from '../src/lib/billingSchema.ts'
import {
  OPEN_INVOICE_EXISTS_SQL,
  PAYMENTS_SELECT_SQL,
  BillingError,
  syncInvoice,
  toPayment,
  loadBilling,
  resolveStaleSends,
  refreshBilling,
  sendBalanceInvoice
} from '../src/lib/squareBilling.ts'

// ── A small D1 stand-in over node:sqlite ──────────────────────────
// Errors from sqlite are passed through untouched, so 'UNIQUE constraint failed' stays visible.
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

function setup() {
  const sqlite = new DatabaseSync(':memory:')
  sqlite.exec(`
    CREATE TABLE Services (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, price INTEGER NOT NULL);
    CREATE TABLE Schedule_Slots (id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT NOT NULL);
    CREATE TABLE Bookings (
      id INTEGER PRIMARY KEY AUTOINCREMENT, service_id INTEGER, slot_id INTEGER,
      client_name TEXT NOT NULL, client_email TEXT NOT NULL, price_at_booking INTEGER NOT NULL,
      status TEXT DEFAULT 'pending', deposit_paid INTEGER DEFAULT 0, custom_price INTEGER, deposit_percent INTEGER,
      photo_permission_portfolio BOOLEAN DEFAULT 0, photo_permission_social BOOLEAN DEFAULT 0,
      photo_permission_accepted_at TEXT, photo_permission_version TEXT DEFAULT 'v1'
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
    INSERT INTO Schedule_Slots (id, date) VALUES (1, '2026-11-20');
    INSERT INTO Bookings (id, service_id, slot_id, client_name, client_email, price_at_booking, status, deposit_paid, deposit_percent)
      VALUES (1, 1, 1, 'Ana Diaz', 'ana@example.com', 50000, 'confirmed', 30000, 60);
    INSERT INTO Admin_Settings (setting_key, setting_value) VALUES ('timezone', 'America/New_York');
  `)
  return { sqlite, db: createD1(sqlite) }
}

function addInvoice(sqlite: DatabaseSync, opts: { status: string; id?: string | null; version?: number | null; key?: string; createdAt?: string }) {
  sqlite.prepare(
    `INSERT INTO Booking_Invoices (booking_id, attempt_key, square_invoice_id, version, amount_cents, status, created_at)
     VALUES (1, ?, ?, ?, 20000, ?, COALESCE(?, CURRENT_TIMESTAMP))`
  ).run(opts.key ?? crypto.randomUUID(), opts.id ?? null, opts.version ?? null, opts.status, opts.createdAt ?? null)
}

const TZ = 'America/New_York'
const paidInvoice = (version: number, status = 'PAID') => ({
  id: 'inv_1',
  version,
  status,
  invoiceNumber: '000123',
  publicUrl: 'https://squareup.com/pay-invoice/inv_1',
  updatedAt: '2026-11-07T03:30:00Z', // Nov 6 in New York
  paymentRequests: [{ dueDate: '2026-11-13', totalCompletedAmountMoney: { amount: 20000n, currency: 'USD' } }]
})

test('syncInvoice twice on a PAID invoice records exactly one payment', async () => {
  const { sqlite, db } = setup()
  addInvoice(sqlite, { status: 'UNPAID', id: 'inv_1', version: 1 })
  await syncInvoice(db, paidInvoice(3), TZ)
  await syncInvoice(db, paidInvoice(3), TZ)
  const payments = sqlite.prepare('SELECT * FROM Booking_Payments').all() as any[]
  assert.equal(payments.length, 1)
  assert.equal(payments[0].amount, 20000)
  assert.equal(payments[0].method, 'Square')
  assert.equal(payments[0].paid_on, '2026-11-06')
  assert.equal(payments[0].note, 'Square invoice #000123')
  assert.equal(payments[0].booking_id, 1)
  const inv = sqlite.prepare('SELECT * FROM Booking_Invoices').get() as any
  assert.equal(inv.status, 'PAID')
  assert.equal(inv.version, 3)
  assert.equal(inv.invoice_number, '000123')
  assert.equal(inv.due_date, '2026-11-13')
  assert.equal(inv.public_url, 'https://squareup.com/pay-invoice/inv_1')
})

test('an older invoice version does not overwrite a newer status', async () => {
  const { sqlite, db } = setup()
  addInvoice(sqlite, { status: 'UNPAID', id: 'inv_1', version: 1 })
  await syncInvoice(db, { id: 'inv_1', version: 5, status: 'CANCELED' }, TZ)
  await syncInvoice(db, { id: 'inv_1', version: 4, status: 'UNPAID' }, TZ)
  const inv = sqlite.prepare('SELECT status, version FROM Booking_Invoices').get() as any
  assert.equal(inv.status, 'CANCELED')
  assert.equal(inv.version, 5)
})

test('a REFUNDED invoice with collected > 0 records the payment (snake_case keys)', async () => {
  const { sqlite, db } = setup()
  addInvoice(sqlite, { status: 'UNPAID', id: 'inv_1', version: 1 })
  await syncInvoice(db, {
    id: 'inv_1',
    version: 7,
    status: 'REFUNDED',
    updated_at: '2026-11-06T15:00:00Z',
    payment_requests: [{ total_completed_amount_money: { amount: 15000 } }]
  }, TZ)
  const payments = sqlite.prepare('SELECT amount, note FROM Booking_Payments').all() as any[]
  assert.equal(payments.length, 1)
  assert.equal(payments[0].amount, 15000)
  assert.equal(payments[0].note, 'Square invoice')
})

test('an invoice that is not ours never records a payment', async () => {
  const { sqlite, db } = setup()
  await syncInvoice(db, { ...paidInvoice(2), id: 'inv_other' }, TZ)
  assert.equal((sqlite.prepare('SELECT COUNT(*) AS n FROM Booking_Payments').get() as any).n, 0)
})

test('a DRAFT read never replaces a CREATING row', async () => {
  const { sqlite, db } = setup()
  addInvoice(sqlite, { status: 'CREATING', id: 'inv_1', version: 0 })
  await syncInvoice(db, { id: 'inv_1', version: 0, status: 'DRAFT' }, TZ)
  assert.equal((sqlite.prepare('SELECT status FROM Booking_Invoices').get() as any).status, 'CREATING')
  await syncInvoice(db, { id: 'inv_1', version: 1, status: 'UNPAID' }, TZ)
  assert.equal((sqlite.prepare('SELECT status FROM Booking_Invoices').get() as any).status, 'UNPAID')
})

test('a second CREATING row for the same booking fails with UNIQUE constraint failed', async () => {
  const { db } = setup()
  const claim = () =>
    db.prepare("INSERT INTO Booking_Invoices (booking_id, attempt_key, amount_cents, status) VALUES (?, ?, 0, 'CREATING')")
      .bind(1, crypto.randomUUID()).run()
  await claim()
  await assert.rejects(claim(), (err: any) => String(err.message).includes('UNIQUE constraint failed'))
})

test('the atomic charge insert is refused while an invoice is open and allowed after it is cancelled', async () => {
  const { sqlite, db } = setup()
  addInvoice(sqlite, { status: 'UNPAID', id: 'inv_1', version: 1 })
  const insertCharge = () =>
    db.prepare(
      `INSERT INTO Booking_Charges (booking_id, description, amount_cents)
       SELECT ?, ?, ? WHERE NOT ${OPEN_INVOICE_EXISTS_SQL}`
    ).bind(1, 'Overtime – 1 hr', 7500, 1).run()
  assert.equal((await insertCharge()).meta.changes, 0)
  sqlite.exec("UPDATE Booking_Invoices SET status = 'CANCELED'")
  assert.equal((await insertCharge()).meta.changes, 1)
})

test('toPayment: an invoice payment is not removable while PAID, and is after a refund', async () => {
  const { sqlite, db } = setup()
  addInvoice(sqlite, { status: 'UNPAID', id: 'inv_1', version: 1 })
  await syncInvoice(db, paidInvoice(3), TZ)
  sqlite.exec("INSERT INTO Booking_Payments (booking_id, amount, method, paid_on) VALUES (1, 1000, 'Cash', '2026-11-01')")
  const list = async () => ((await db.prepare(PAYMENTS_SELECT_SQL).bind(1).all()).results as any[]).map(toPayment)

  let payments = await list()
  assert.equal(payments.length, 2)
  assert.deepEqual(payments.map((p) => [p.method, p.square_invoice_id, p.removable]), [
    ['Cash', null, true],
    ['Square', 'inv_1', false]
  ])
  await syncInvoice(db, paidInvoice(4, 'REFUNDED'), TZ)
  payments = await list()
  assert.equal(payments.length, 2)
  assert.equal(payments[1].removable, true)
})

test('loadBilling returns charges oldest first, invoices newest first, and totals with charges', async () => {
  const { sqlite, db } = setup()
  addInvoice(sqlite, { status: 'CANCELED', id: 'inv_a', version: 2 })
  addInvoice(sqlite, { status: 'UNPAID', id: 'inv_b', version: 1 })
  sqlite.exec("INSERT INTO Booking_Charges (booking_id, description, amount_cents) VALUES (1, 'First', 5000), (1, 'Second', 2500)")
  const billing = await loadBilling(db, 1)
  assert.ok(billing)
  assert.deepEqual(billing.charges.map((c: any) => c.description), ['First', 'Second'])
  assert.deepEqual(billing.invoices.map((i: any) => i.square_invoice_id), ['inv_b', 'inv_a'])
  assert.equal(billing.invoices[0].is_open, true)
  assert.equal(billing.invoices[0].label, 'Sent')
  assert.equal(billing.totals.total_cents, 57500)
  assert.equal(billing.totals.balance_cents, 27500)
  assert.equal(await loadBilling(db, 99), null)
})

test('resolveStaleSends deletes stale CREATING rows without a Square id and keeps fresh ones', async () => {
  const { sqlite, db } = setup()
  addInvoice(sqlite, { status: 'CREATING', createdAt: '2000-01-01 00:00:00' })
  assert.deepEqual(await resolveStaleSends(db, {}, 1), { stale: false })
  assert.equal((sqlite.prepare('SELECT COUNT(*) AS n FROM Booking_Invoices').get() as any).n, 0)
  addInvoice(sqlite, { status: 'CREATING' })
  await resolveStaleSends(db, {}, 1)
  assert.equal((sqlite.prepare('SELECT COUNT(*) AS n FROM Booking_Invoices').get() as any).n, 1)
})

test('refreshBilling reports stale when Square is not configured for a row with an id', async () => {
  const { sqlite, db } = setup()
  addInvoice(sqlite, { status: 'CREATING', id: 'inv_1', version: 0, createdAt: '2000-01-01 00:00:00' })
  const billing = await refreshBilling(db, {}, 1)
  assert.ok(billing)
  assert.equal(billing.stale, true)
  assert.equal(billing.invoices[0].status, 'CREATING')
  assert.equal(await refreshBilling(db, {}, 99), null)
})

const SQUARE_ENV = { SQUARE_ACCESS_TOKEN: 'test-token', SQUARE_LOCATION_ID: 'LOC' }
const code = (expected: string) => (err: any) => err instanceof BillingError && err.code === expected

test('sendBalanceInvoice pre-checks run in the documented order without calling Square', async () => {
  const { sqlite, db } = setup()
  await assert.rejects(sendBalanceInvoice(db, SQUARE_ENV, 99, 20000), code('NOT_FOUND'))
  await assert.rejects(sendBalanceInvoice(db, {}, 1, 'x'), code('SQUARE_NOT_CONFIGURED'))
  sqlite.exec("UPDATE Bookings SET client_email = ' not-an-email '")
  await assert.rejects(sendBalanceInvoice(db, SQUARE_ENV, 1, 'x'), code('INVALID_EMAIL'))
  sqlite.exec("UPDATE Bookings SET client_email = 'ana@example.com'")
  await assert.rejects(sendBalanceInvoice(db, SQUARE_ENV, 1, '20000'), (err: any) =>
    code('VALIDATION_FAILED')(err) && err.details[0].field === 'expected_amount_cents')
  sqlite.exec("UPDATE Bookings SET status = 'cancelled'")
  await assert.rejects(sendBalanceInvoice(db, {}, 1, 20000), code('BOOKING_CANCELLED'))
})

test('sendBalanceInvoice releases its claim on BALANCE_CHANGED and NO_BALANCE, and refuses a second open invoice', async () => {
  const { sqlite, db } = setup()
  const count = () => (sqlite.prepare('SELECT COUNT(*) AS n FROM Booking_Invoices').get() as any).n
  await assert.rejects(sendBalanceInvoice(db, SQUARE_ENV, 1, 1), (err: any) =>
    code('BALANCE_CHANGED')(err) && err.details[0].balance_cents === 20000 && err.message.includes('$200.00'))
  assert.equal(count(), 0)

  sqlite.exec('UPDATE Bookings SET deposit_paid = 50000')
  await assert.rejects(sendBalanceInvoice(db, SQUARE_ENV, 1, 0), code('NO_BALANCE'))
  assert.equal(count(), 0)

  addInvoice(sqlite, { status: 'UNPAID', id: 'inv_1', version: 1 })
  await assert.rejects(sendBalanceInvoice(db, SQUARE_ENV, 1, 0), code('INVOICE_OPEN'))
  sqlite.exec("UPDATE Booking_Invoices SET status = 'CREATING'")
  await assert.rejects(sendBalanceInvoice(db, SQUARE_ENV, 1, 0), code('INVOICE_SENDING'))
})

test('photo permission compliance columns store audit trail properly in Bookings', async () => {
  const { sqlite, db } = setup()
  const timestamp = new Date().toISOString()
  
  // Insert with explicit photo permissions
  await db.prepare(
    `INSERT INTO Bookings (
      service_id, slot_id, client_name, client_email, price_at_booking, status,
      photo_permission_portfolio, photo_permission_social, photo_permission_accepted_at, photo_permission_version
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(1, 1, 'John Doe', 'john@example.com', 50000, 'confirmed', 1, 0, timestamp, 'v1').run()

  const row = (await db.prepare('SELECT * FROM Bookings WHERE client_email = ?').bind('john@example.com').first()) as any
  assert.equal(row.client_name, 'John Doe')
  assert.equal(row.photo_permission_portfolio, 1)
  assert.equal(row.photo_permission_social, 0)
  assert.equal(row.photo_permission_accepted_at, timestamp)
  assert.equal(row.photo_permission_version, 'v1')

  // Check default values when not provided
  const defaultRow = (await db.prepare('SELECT * FROM Bookings WHERE id = 1').first()) as any
  assert.equal(defaultRow.photo_permission_portfolio, 0)
  assert.equal(defaultRow.photo_permission_social, 0)
  assert.equal(defaultRow.photo_permission_accepted_at, null)
  assert.equal(defaultRow.photo_permission_version, 'v1')
})

test('Audit 3: 0002_add_photo_permissions migration and ensurePhotoPermissionsColumns execute without data loss', async () => {
  const sqlite = new DatabaseSync(':memory:')
  const db = createD1(sqlite)

  // 1. Setup legacy Bookings table (missing photo_permission_* columns)
  sqlite.exec(`
    CREATE TABLE Schedule_Slots (id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT NOT NULL);
    CREATE TABLE Bookings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      service_id INTEGER,
      slot_id INTEGER,
      client_name TEXT NOT NULL,
      client_email TEXT NOT NULL,
      price_at_booking INTEGER NOT NULL,
      status TEXT DEFAULT 'pending',
      customer_phone TEXT DEFAULT '',
      location TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      deposit_paid INTEGER DEFAULT 0
    );
    INSERT INTO Schedule_Slots (id, date) VALUES (1, '2026-11-20');
    INSERT INTO Bookings (id, service_id, slot_id, client_name, client_email, price_at_booking, status, customer_phone, location, notes, deposit_paid)
      VALUES (1, 1, 1, 'Elena Rostova', 'elena@example.com', 60000, 'confirmed', '555-9876', 'Studio', 'Legacy booking notes', 36000);
  `)

  // Pre-condition: columns do not exist
  const beforeCols = (sqlite.prepare('PRAGMA table_info(Bookings)').all() as any[]).map(c => c.name)
  assert.ok(!beforeCols.includes('photo_permission_portfolio'))
  assert.ok(!beforeCols.includes('photo_permission_social'))
  assert.ok(!beforeCols.includes('photo_permission_accepted_at'))
  assert.ok(!beforeCols.includes('photo_permission_version'))

  // 2. Read migration file and verify contents
  const migrationPath = resolve(process.cwd(), 'migrations/0002_add_photo_permissions.sql')
  const migrationSql = readFileSync(migrationPath, 'utf8')
  assert.ok(migrationSql.includes('photo_permission_portfolio'))
  assert.ok(migrationSql.includes('photo_permission_social'))
  assert.ok(migrationSql.includes('photo_permission_accepted_at'))
  assert.ok(migrationSql.includes('photo_permission_version'))

  // 3. Apply schema check helper
  await ensurePhotoPermissionsColumns(db)

  // 4. Verify columns now exist
  const afterCols = (sqlite.prepare('PRAGMA table_info(Bookings)').all() as any[]).map(c => c.name)
  assert.ok(afterCols.includes('photo_permission_portfolio'))
  assert.ok(afterCols.includes('photo_permission_social'))
  assert.ok(afterCols.includes('photo_permission_accepted_at'))
  assert.ok(afterCols.includes('photo_permission_version'))

  // 5. Verify existing booking data preserved with ZERO data loss
  const row = sqlite.prepare('SELECT * FROM Bookings WHERE id = 1').get() as any
  assert.equal(row.client_name, 'Elena Rostova')
  assert.equal(row.client_email, 'elena@example.com')
  assert.equal(row.price_at_booking, 60000)
  assert.equal(row.status, 'confirmed')
  assert.equal(row.customer_phone, '555-9876')
  assert.equal(row.location, 'Studio')
  assert.equal(row.notes, 'Legacy booking notes')
  assert.equal(row.deposit_paid, 36000)

  // 6. Verify default values on existing rows
  assert.equal(row.photo_permission_portfolio, 0)
  assert.equal(row.photo_permission_social, 0)
  assert.equal(row.photo_permission_accepted_at, null)
  assert.equal(row.photo_permission_version, 'v1')

  // 7. Verify idempotency: re-running does not throw or corrupt data
  await ensurePhotoPermissionsColumns(db)
  const rowAfterSecond = sqlite.prepare('SELECT * FROM Bookings WHERE id = 1').get() as any
  assert.deepEqual(row, rowAfterSecond)
})

test('Audit 5: replaceMediaStorageChunks executes atomic chunk deletion and replacement in a single batch', async () => {
  const sqlite = new DatabaseSync(':memory:')
  const db = createD1(sqlite)

  const fileKey = 'portfolio/test-atomic.webp'

  // 1. Initial write: 1200 KB image (3 chunks of 512KB: 512KB, 512KB, 176KB)
  const initialSize = 1200 * 1024
  const initialBuf = new Uint8Array(initialSize)
  for (let i = 0; i < initialSize; i++) initialBuf[i] = i % 256
  await replaceMediaStorageChunks(db, fileKey, initialBuf.buffer, 'image/webp')

  const initialRows = sqlite.prepare('SELECT chunk_index, length(data) as len FROM Media_Storage WHERE file_key = ? ORDER BY chunk_index ASC').all(fileKey) as any[]
  assert.equal(initialRows.length, 3)
  assert.equal(initialRows[0].chunk_index, 0)
  assert.equal(initialRows[0].len, 512 * 1024)
  assert.equal(initialRows[1].chunk_index, 1)
  assert.equal(initialRows[1].len, 512 * 1024)
  assert.equal(initialRows[2].chunk_index, 2)
  assert.equal(initialRows[2].len, 176 * 1024)

  // 2. Replacement write: 300 KB image (1 chunk of 300KB)
  // Must atomically delete the old 3 chunks and insert the single new chunk
  const replaceSize = 300 * 1024
  const replaceBuf = new Uint8Array(replaceSize)
  replaceBuf.fill(42)
  await replaceMediaStorageChunks(db, fileKey, replaceBuf.buffer, 'image/webp')

  const replacedRows = sqlite.prepare('SELECT chunk_index, length(data) as len, data FROM Media_Storage WHERE file_key = ? ORDER BY chunk_index ASC').all(fileKey) as any[]
  assert.equal(replacedRows.length, 1, 'Old chunks 1 and 2 must be purged atomically; only chunk 0 should remain')
  assert.equal(replacedRows[0].chunk_index, 0)
  assert.equal(replacedRows[0].len, replaceSize)
  assert.equal(new Uint8Array(replacedRows[0].data)[0], 42)
})

test('Audit 1: /admin/assets/wasm/*.wasm and /admin/assets/js/webpEncoder.worker.js MIME routing and HTML fallback prevention', async () => {
  const dummyWasmBytes = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0])
  const dummyWorkerScript = 'self.onmessage = () => {};'

  const mockAssets: any = {
    fetch: async (req: Request) => {
      const url = new URL(req.url)
      if (url.pathname === '/admin/assets/wasm/webp_enc.wasm') {
        return new Response(dummyWasmBytes, {
          status: 200,
          headers: { 'Content-Type': 'application/wasm' }
        })
      }
      if (url.pathname === '/admin/assets/js/webpEncoder.worker.js') {
        return new Response(dummyWorkerScript, {
          status: 200,
          headers: { 'Content-Type': 'application/javascript' }
        })
      }
      if (url.pathname === '/admin/assets/wasm/missing.wasm') {
        // Simulates ASSETS returning 404 or SPA HTML fallback
        return new Response('<!DOCTYPE html><html><body>SPA fallback</body></html>', {
          status: 200,
          headers: { 'Content-Type': 'text/html; charset=utf-8' }
        })
      }
      if (url.pathname === '/admin/assets/js/missing.worker.js') {
        return new Response('<!DOCTYPE html><html><body>SPA fallback</body></html>', {
          status: 200,
          headers: { 'Content-Type': 'text/html; charset=utf-8' }
        })
      }
      return new Response('Not Found', { status: 404 })
    }
  }

  const env = { ASSETS: mockAssets } as any

  // 1. Valid wasm asset returns 200 with application/wasm and nosniff
  const wasmRes = await realApp.fetch(new Request('http://localhost/admin/assets/wasm/webp_enc.wasm'), env)
  assert.equal(wasmRes.status, 200)
  assert.equal(wasmRes.headers.get('Content-Type'), 'application/wasm')
  assert.equal(wasmRes.headers.get('X-Content-Type-Options'), 'nosniff')

  // 2. Valid worker script returns 200 with application/javascript and no-store
  const workerRes = await realApp.fetch(new Request('http://localhost/admin/assets/js/webpEncoder.worker.js'), env)
  assert.equal(workerRes.status, 200)
  assert.equal(workerRes.headers.get('Content-Type'), 'application/javascript')
  assert.equal(workerRes.headers.get('Cache-Control'), 'no-store, no-cache, must-revalidate')

  // 3. Wasm request returning HTML fallback from ASSETS is rejected with 404
  const wasmHtmlFallbackRes = await realApp.fetch(new Request('http://localhost/admin/assets/wasm/missing.wasm'), env)
  assert.equal(wasmHtmlFallbackRes.status, 404)
  assert.notEqual(wasmHtmlFallbackRes.headers.get('Content-Type'), 'text/html')

  // 4. Worker request returning HTML fallback from ASSETS is rejected with 404
  const workerHtmlFallbackRes = await realApp.fetch(new Request('http://localhost/admin/assets/js/missing.worker.js'), env)
  assert.equal(workerHtmlFallbackRes.status, 404)
  assert.notEqual(workerHtmlFallbackRes.headers.get('Content-Type'), 'text/html')
})
