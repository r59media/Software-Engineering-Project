/**
 * D1 DDL for the billing tables (payments, charges, invoices).
 * No imports, so admin.ts and the Node tests share the exact same SQL.
 * No REFERENCES clauses on purpose: these rows must never block a Bookings rebuild.
 */

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
  { sql: BOOKING_CHARGES_TABLE_SQL, ignoreError: false },
  { sql: BOOKING_CHARGES_INDEX_SQL, ignoreError: false },
  { sql: BOOKING_INVOICES_TABLE_SQL, ignoreError: false },
  { sql: BOOKING_INVOICES_OPEN_INDEX_SQL, ignoreError: false }
]
