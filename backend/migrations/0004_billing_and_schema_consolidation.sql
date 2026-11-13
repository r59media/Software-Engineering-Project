-- Migration 0004: Consolidate billing, media storage, and missing schema objects

-- 1. Missing Tables (idempotent)
CREATE TABLE IF NOT EXISTS Admin_Settings (
  setting_key TEXT PRIMARY KEY,
  setting_value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS Schedule_Slots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  is_booked BOOLEAN DEFAULT 0
);

CREATE TABLE IF NOT EXISTS Booking_Payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER NOT NULL,
  amount INTEGER NOT NULL,
  method TEXT NOT NULL,
  paid_on TEXT NOT NULL,
  note TEXT DEFAULT '',
  square_invoice_id TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS Booking_Charges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER NOT NULL,
  description TEXT NOT NULL CHECK (length(description) BETWEEN 1 AND 120),
  amount_cents INTEGER NOT NULL CHECK (amount_cents BETWEEN 1 AND 100000000),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS Booking_Invoices (
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
);

CREATE TABLE IF NOT EXISTS Media_Storage (
  file_key TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  content_type TEXT NOT NULL DEFAULT 'image/webp',
  data BLOB NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (file_key, chunk_index)
);

-- 2. Performance & Billing Indexes (idempotent)
CREATE INDEX IF NOT EXISTS idx_services_active_order ON Services(is_active, display_order);
CREATE UNIQUE INDEX IF NOT EXISTS idx_bookings_active_slot ON Bookings(slot_id) WHERE status != 'cancelled';
CREATE INDEX IF NOT EXISTS idx_bookings_slot ON Bookings(slot_id);
CREATE INDEX IF NOT EXISTS idx_bookings_service ON Bookings(service_id);
CREATE INDEX IF NOT EXISTS idx_bookings_created ON Bookings(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_booking_payments_booking ON Booking_Payments(booking_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_square_invoice ON Booking_Payments(square_invoice_id);
CREATE INDEX IF NOT EXISTS idx_booking_charges_booking ON Booking_Charges(booking_id);
CREATE INDEX IF NOT EXISTS idx_invoices_booking ON Booking_Invoices(booking_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_attempt ON Booking_Invoices(attempt_key);
CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_square ON Booking_Invoices(square_invoice_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_one_open ON Booking_Invoices(booking_id)
  WHERE status IN ('CREATING','DRAFT','UNPAID','SCHEDULED','PARTIALLY_PAID','PAYMENT_PENDING');

