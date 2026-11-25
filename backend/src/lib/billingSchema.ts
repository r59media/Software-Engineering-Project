/**
 * D1 DDL for the billing tables (payments, charges, invoices).
 * No imports, so admin.ts and the Node tests share the exact same SQL.
 * No REFERENCES clauses on purpose: these rows must never block a Bookings rebuild.
 */

/**
 * Runs an async initialization routine once per D1Database instance with concurrent-caller coalescing
 * and automatic cache eviction if initialization fails.
 */
export function runOncePerDb(
  cache: WeakMap<object, Promise<void>>,
  db: D1Database | undefined,
  initFn: (db: D1Database) => Promise<boolean | void>
): Promise<void> {
  if (!db) return Promise.resolve()
  const existing = cache.get(db)
  if (existing) return existing

  const promise = (async () => {
    const result = await initFn(db)
    if (result === false) {
      cache.delete(db)
    }
  })().catch((err) => {
    cache.delete(db)
    throw err
  })

  cache.set(db, promise)
  return promise
}

export const BOOKING_PAYMENTS_TABLE_SQL = `CREATE TABLE IF NOT EXISTS Booking_Payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER NOT NULL,
  amount INTEGER NOT NULL,
  method TEXT NOT NULL,
  paid_on TEXT NOT NULL,
  note TEXT DEFAULT '',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)`

export const BOOKING_PAYMENTS_INDEX_SQL =
  'CREATE INDEX IF NOT EXISTS idx_booking_payments_booking ON Booking_Payments(booking_id)'

export const BOOKING_PAYMENTS_SQUARE_COLUMN_SQL = 'ALTER TABLE Booking_Payments ADD COLUMN square_invoice_id TEXT'

export const BOOKING_PAYMENTS_SQUARE_INDEX_SQL =
  'CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_square_invoice ON Booking_Payments(square_invoice_id)'

export const BOOKING_PAYMENTS_TERMINAL_COL_SQL =
  'ALTER TABLE Booking_Payments ADD COLUMN square_terminal_checkout_id TEXT'

export const BOOKING_PAYMENTS_REFUND_COL_SQL =
  'ALTER TABLE Booking_Payments ADD COLUMN square_refund_id TEXT'

export const BOOKING_PAYMENTS_TERMINAL_INDEX_SQL =
  'CREATE UNIQUE INDEX IF NOT EXISTS idx_booking_payments_terminal_checkout ON Booking_Payments(square_terminal_checkout_id) WHERE square_terminal_checkout_id IS NOT NULL'

export const BOOKING_PAYMENTS_REFUND_INDEX_SQL =
  'CREATE UNIQUE INDEX IF NOT EXISTS idx_booking_payments_refund_id ON Booking_Payments(square_refund_id) WHERE square_refund_id IS NOT NULL'

export const RATE_LIMITS_TABLE_SQL =
  'CREATE TABLE IF NOT EXISTS Rate_Limits (bucket TEXT PRIMARY KEY, count INTEGER NOT NULL, window_start INTEGER NOT NULL)'

export const LEADS_TABLE_SQL = `CREATE TABLE IF NOT EXISTS Leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  session_type TEXT,
  message TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)`

export const LEADS_CREATED_INDEX_SQL =
  'CREATE INDEX IF NOT EXISTS idx_leads_created ON Leads(created_at DESC)'

export const BOOKING_CHARGES_TABLE_SQL = `CREATE TABLE IF NOT EXISTS Booking_Charges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER NOT NULL,
  description TEXT NOT NULL CHECK (length(description) BETWEEN 1 AND 120),
  amount_cents INTEGER NOT NULL CHECK (amount_cents BETWEEN 1 AND 100000000),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)`

export const BOOKING_CHARGES_INDEX_SQL =
  'CREATE INDEX IF NOT EXISTS idx_booking_charges_booking ON Booking_Charges(booking_id)'

export const BOOKING_INVOICES_TABLE_SQL = `CREATE TABLE IF NOT EXISTS Booking_Invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER NOT NULL,
  attempt_key TEXT NOT NULL UNIQUE,
  square_invoice_id TEXT UNIQUE,
  square_order_id TEXT,
  invoice_number TEXT,
  version INTEGER,
  amount_cents INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  public_url TEXT,
  due_date TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)`

export const BOOKING_INVOICES_OPEN_INDEX_SQL = `CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_one_open ON Booking_Invoices(booking_id)
  WHERE status IN ('CREATING','DRAFT','UNPAID','SCHEDULED','PARTIALLY_PAID','PAYMENT_PENDING')`

/** Run in order after Booking_Payments exists. ignoreError steps may fail harmlessly (column already added). */
export const BILLING_SCHEMA_STEPS: readonly { sql: string; ignoreError: boolean }[] = [
  { sql: BOOKING_PAYMENTS_SQUARE_COLUMN_SQL, ignoreError: true },
  { sql: BOOKING_PAYMENTS_SQUARE_INDEX_SQL, ignoreError: false },
  { sql: BOOKING_PAYMENTS_TERMINAL_COL_SQL, ignoreError: true },
  { sql: BOOKING_PAYMENTS_REFUND_COL_SQL, ignoreError: true },
  { sql: BOOKING_PAYMENTS_TERMINAL_INDEX_SQL, ignoreError: false },
  { sql: BOOKING_PAYMENTS_REFUND_INDEX_SQL, ignoreError: false },
  { sql: BOOKING_CHARGES_TABLE_SQL, ignoreError: false },
  { sql: BOOKING_CHARGES_INDEX_SQL, ignoreError: false },
  { sql: BOOKING_INVOICES_TABLE_SQL, ignoreError: false },
  { sql: BOOKING_INVOICES_OPEN_INDEX_SQL, ignoreError: false },
  { sql: RATE_LIMITS_TABLE_SQL, ignoreError: false },
  { sql: LEADS_TABLE_SQL, ignoreError: false },
  { sql: LEADS_CREATED_INDEX_SQL, ignoreError: false }
]

/**
 * Safely applies photo permission and Phase 2 audit columns to existing Bookings & Coupons tables if missing.
 * Verifies column presence against PRAGMA table_info(...) to prevent errors and ensure
 * schema migration executes cleanly on production D1 instances.
 * Returns true when Bookings exists and all columns are verified/applied, false otherwise.
 */
export async function ensurePhotoPermissionsColumns(db: any): Promise<boolean> {
  try {
    const info = await db.prepare('PRAGMA table_info(Bookings)').all()
    const existing = new Set((info.results || []).map((col: any) => String(col.name).toLowerCase()))

    if (existing.size === 0) return false // Bookings table does not exist yet

    const statements: string[] = []
    if (!existing.has('photo_permission_portfolio')) {
      statements.push('ALTER TABLE Bookings ADD COLUMN photo_permission_portfolio BOOLEAN DEFAULT 0')
    }
    if (!existing.has('photo_permission_social')) {
      statements.push('ALTER TABLE Bookings ADD COLUMN photo_permission_social BOOLEAN DEFAULT 0')
    }
    if (!existing.has('photo_permission_accepted_at')) {
      statements.push('ALTER TABLE Bookings ADD COLUMN photo_permission_accepted_at TEXT')
    }
    if (!existing.has('photo_permission_version')) {
      statements.push("ALTER TABLE Bookings ADD COLUMN photo_permission_version TEXT DEFAULT 'v1'")
    }
    if (!existing.has('event_location')) {
      statements.push('ALTER TABLE Bookings ADD COLUMN event_location TEXT')
    }
    if (!existing.has('agreement_signed_name')) {
      statements.push('ALTER TABLE Bookings ADD COLUMN agreement_signed_name TEXT')
    }
    if (!existing.has('agreement_signed_at')) {
      statements.push('ALTER TABLE Bookings ADD COLUMN agreement_signed_at TEXT')
    }
    if (!existing.has('applied_fees_json')) {
      statements.push('ALTER TABLE Bookings ADD COLUMN applied_fees_json TEXT')
    }
    if (!existing.has('checkout_idempotency_key')) {
      statements.push('ALTER TABLE Bookings ADD COLUMN checkout_idempotency_key TEXT')
    }
    if (!existing.has('locked_slot_ids_json')) {
      statements.push('ALTER TABLE Bookings ADD COLUMN locked_slot_ids_json TEXT')
    }
    if (!existing.has('gcal_sync_status')) {
      statements.push("ALTER TABLE Bookings ADD COLUMN gcal_sync_status TEXT DEFAULT 'synced'")
    }
    if (!existing.has('reschedule_count')) {
      statements.push('ALTER TABLE Bookings ADD COLUMN reschedule_count INTEGER NOT NULL DEFAULT 0')
    }

    for (const sql of statements) {
      await db.prepare(sql).run()
    }
    await db
      .prepare(
        'CREATE UNIQUE INDEX IF NOT EXISTS idx_bookings_checkout_idempotency ON Bookings(checkout_idempotency_key) WHERE checkout_idempotency_key IS NOT NULL'
      )
      .run()

    // Upgrade Coupons if the table exists in this DB
    const couponInfo = await db.prepare('PRAGMA table_info(Coupons)').all().catch(() => ({ results: [] }))
    const existingCouponCols = new Set((couponInfo.results || []).map((col: any) => String(col.name).toLowerCase()))
    if (existingCouponCols.size > 0) {
      const couponStatements: string[] = []
      if (!existingCouponCols.has('expires_at')) {
        couponStatements.push('ALTER TABLE Coupons ADD COLUMN expires_at TEXT')
      }
      if (!existingCouponCols.has('max_uses')) {
        couponStatements.push('ALTER TABLE Coupons ADD COLUMN max_uses INTEGER')
      }
      if (!existingCouponCols.has('used_count')) {
        couponStatements.push('ALTER TABLE Coupons ADD COLUMN used_count INTEGER NOT NULL DEFAULT 0')
      }
      for (const sql of couponStatements) {
        await db.prepare(sql).run()
      }
    }

    return true
  } catch (err) {
    console.warn('Could not ensure photo permissions / audit columns:', err)
    return false
  }
}

/**
 * Atomic replacement of media chunks in D1 Media_Storage (Audit 5).
 * Executes deletion of old chunks and insertion of new 512KB chunks in a single atomic c.env.DB.batch([...]) transaction.
 */
export async function replaceMediaStorageChunks(
  db: any,
  fileKey: string,
  arrayBuffer: ArrayBuffer,
  contentType: string = 'image/webp'
): Promise<void> {
  await db.prepare(
    'CREATE TABLE IF NOT EXISTS Media_Storage (file_key TEXT NOT NULL, chunk_index INTEGER NOT NULL, content_type TEXT NOT NULL DEFAULT \'image/webp\', data BLOB NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (file_key, chunk_index))'
  ).run()

  const CHUNK_SIZE = 512 * 1024
  const statements: any[] = []

  // Atomic chunk replacement: old chunk deletion is included in the batch
  statements.push(db.prepare('DELETE FROM Media_Storage WHERE file_key = ?').bind(fileKey))

  let chunkIndex = 0
  for (let offset = 0; offset < arrayBuffer.byteLength; offset += CHUNK_SIZE) {
    const chunk = new Uint8Array(arrayBuffer.slice(offset, offset + CHUNK_SIZE))
    statements.push(
      db.prepare(
        'INSERT INTO Media_Storage (file_key, chunk_index, content_type, data) VALUES (?, ?, ?, ?)'
      ).bind(fileKey, chunkIndex, contentType, chunk)
    )
    chunkIndex++
  }

  if (statements.length === 1) { // Only DELETE was added
    statements.push(
      db.prepare(
        'INSERT INTO Media_Storage (file_key, chunk_index, content_type, data) VALUES (?, ?, ?, ?)'
      ).bind(fileKey, 0, contentType, new Uint8Array(0))
    )
  }

  // Execute deletion of old chunks and insertion of new chunks in a single atomic batch transaction
  await db.batch(statements)
}
