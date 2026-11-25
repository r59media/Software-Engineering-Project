-- Migration 0005: Phase 2 Audit Hardening (idempotent indexes/tables + new columns)
-- NOTE: Only genuinely new columns are ALTERed here because SQLite lacks ADD COLUMN IF NOT EXISTS.

-- 1. Booking_Payments deduplication columns & partial unique indexes
ALTER TABLE Booking_Payments ADD COLUMN square_terminal_checkout_id TEXT;
ALTER TABLE Booking_Payments ADD COLUMN square_refund_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_booking_payments_terminal_checkout
  ON Booking_Payments(square_terminal_checkout_id)
  WHERE square_terminal_checkout_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_booking_payments_refund_id
  ON Booking_Payments(square_refund_id)
  WHERE square_refund_id IS NOT NULL;

-- 2. Bookings idempotency, multi-slot tracking, calendar sync status, and reschedule counter
ALTER TABLE Bookings ADD COLUMN checkout_idempotency_key TEXT;
ALTER TABLE Bookings ADD COLUMN locked_slot_ids_json TEXT;
ALTER TABLE Bookings ADD COLUMN gcal_sync_status TEXT DEFAULT 'synced';
ALTER TABLE Bookings ADD COLUMN reschedule_count INTEGER NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX IF NOT EXISTS idx_bookings_checkout_idempotency
  ON Bookings(checkout_idempotency_key)
  WHERE checkout_idempotency_key IS NOT NULL;

-- 3. Coupons expiry & usage limits
ALTER TABLE Coupons ADD COLUMN expires_at TEXT;
ALTER TABLE Coupons ADD COLUMN max_uses INTEGER;
ALTER TABLE Coupons ADD COLUMN used_count INTEGER NOT NULL DEFAULT 0;

-- 4. Distributed D1 rate limits & Leads table DDL
CREATE TABLE IF NOT EXISTS Rate_Limits (
  bucket TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  window_start INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS Leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  session_type TEXT,
  message TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_leads_created ON Leads(created_at DESC);
