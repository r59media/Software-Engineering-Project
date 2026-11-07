-- schema.sql

DROP TABLE IF EXISTS Booking_Charges; -- child of Bookings (link enforced in code), dropped first
DROP TABLE IF EXISTS Booking_Invoices; -- child of Bookings (link enforced in code), dropped first
DROP TABLE IF EXISTS Booking_Payments; -- child of Bookings (link enforced in code), dropped first
DROP TABLE IF EXISTS Bookings;
DROP TABLE IF EXISTS Leads;
DROP TABLE IF EXISTS Schedule_Slots;
DROP TABLE IF EXISTS Admin_Settings;
DROP TABLE IF EXISTS Portfolio_Images;
DROP TABLE IF EXISTS Services;
DROP TABLE IF EXISTS Coupons;
DROP TABLE IF EXISTS Blocked_Dates;
DROP TABLE IF EXISTS Media_Storage; -- uploaded image bytes; without this a reset leaves orphaned blobs

CREATE TABLE Services (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    price INTEGER NOT NULL, -- Stored in cents
    duration_minutes INTEGER NOT NULL,
    outfits INTEGER, -- Number of outfits; NULL when not set
    full_day INTEGER DEFAULT 0, -- 1 when the package books the entire day (duration_minutes is then not used)
    is_active BOOLEAN DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE Leads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    phone TEXT,
    session_type TEXT,
    message TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE Schedule_Slots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL, -- ISO8601 string (e.g., YYYY-MM-DD)
    start_time TEXT NOT NULL, -- (e.g., 10:00)
    end_time TEXT NOT NULL, -- (e.g., 11:00)
    is_booked BOOLEAN DEFAULT 0
);

CREATE TABLE Bookings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    service_id INTEGER, -- NULL = "No package" (custom price)
    slot_id INTEGER NOT NULL,
    client_name TEXT NOT NULL,
    client_email TEXT NOT NULL,
    price_at_booking INTEGER NOT NULL, -- Stored in cents
    square_payment_id TEXT UNIQUE,
    status TEXT DEFAULT 'pending', -- pending, confirmed, cancelled
    customer_phone TEXT DEFAULT '',
    location TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    attendees INTEGER DEFAULT 1,
    deposit_paid INTEGER DEFAULT 0,
    coupon_code TEXT DEFAULT '',
    custom_price INTEGER,
    deposit_percent INTEGER, -- percent charged at online checkout; NULL for older and manual bookings
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (service_id) REFERENCES Services(id),
    FOREIGN KEY (slot_id) REFERENCES Schedule_Slots(id)
);

-- Payments recorded by the admin after the down payment (deposit_paid). Amounts are in cents.
-- No REFERENCES clause on purpose: the link to Bookings(id) is enforced in code (DELETE /api/admin/bookings/:id
-- removes a booking's payments first), so payment rows can never block a Bookings table rebuild.
CREATE TABLE Booking_Payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    booking_id INTEGER NOT NULL,
    amount INTEGER NOT NULL, -- Stored in cents, > 0
    method TEXT NOT NULL, -- Cash, Card, Square, Zelle, Venmo, Cash App, Other
    paid_on TEXT NOT NULL, -- YYYY-MM-DD
    note TEXT DEFAULT '',
    square_invoice_id TEXT, -- set when the payment came from a paid Square invoice (unique, see index below)
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Extra charges (for example overtime) added to a booking. No REFERENCES clause, same reason as Booking_Payments.
CREATE TABLE Booking_Charges (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    booking_id INTEGER NOT NULL,
    description TEXT NOT NULL CHECK (length(description) BETWEEN 1 AND 120),
    amount_cents INTEGER NOT NULL CHECK (amount_cents BETWEEN 1 AND 100000000),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- One row per Square balance-invoice send attempt. No REFERENCES clause, same reason as Booking_Payments.
CREATE TABLE Booking_Invoices (
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
    due_date TEXT, -- YYYY-MM-DD
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE Admin_Settings (
    setting_key TEXT PRIMARY KEY,
    setting_value TEXT NOT NULL
);

CREATE TABLE Portfolio_Images (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    media_key TEXT NOT NULL,
    section TEXT NOT NULL DEFAULT 'gallery', -- recent, gallery, about, hero (which part of the site shows it)
    category TEXT DEFAULT 'All',
    title TEXT,
    alt_text TEXT,
    display_order INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT 1,
    is_featured BOOLEAN DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE Coupons (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL UNIQUE,
    discount_type TEXT NOT NULL DEFAULT 'percent', -- 'percent' or 'amount'
    discount_value REAL NOT NULL,
    description TEXT DEFAULT '',
    is_active BOOLEAN DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE Blocked_Dates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL UNIQUE,
    reason TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE Media_Storage (
    file_key TEXT NOT NULL,
    chunk_index INTEGER NOT NULL,
    content_type TEXT NOT NULL DEFAULT 'image/webp',
    data BLOB NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (file_key, chunk_index)
);

-- Performance Indexes
CREATE INDEX IF NOT EXISTS idx_slots_availability ON Schedule_Slots(is_booked, date, start_time);
CREATE INDEX IF NOT EXISTS idx_portfolio_active ON Portfolio_Images(is_active, display_order);
CREATE INDEX IF NOT EXISTS idx_portfolio_active_cat_order ON Portfolio_Images(is_active, category, display_order);
CREATE INDEX IF NOT EXISTS idx_portfolio_section_order ON Portfolio_Images(is_active, section, display_order);
CREATE INDEX IF NOT EXISTS idx_services_active ON Services(is_active);
CREATE INDEX IF NOT EXISTS idx_bookings_slot ON Bookings(slot_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_bookings_active_slot ON Bookings(slot_id) WHERE status != 'cancelled';
CREATE INDEX IF NOT EXISTS idx_bookings_service ON Bookings(service_id);
CREATE INDEX IF NOT EXISTS idx_bookings_created ON Bookings(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_booking_payments_booking ON Booking_Payments(booking_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_square_invoice ON Booking_Payments(square_invoice_id);
CREATE INDEX IF NOT EXISTS idx_booking_charges_booking ON Booking_Charges(booking_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_one_open ON Booking_Invoices(booking_id)
  WHERE status IN ('CREATING','DRAFT','UNPAID','SCHEDULED','PARTIALLY_PAID','PAYMENT_PENDING');
CREATE INDEX IF NOT EXISTS idx_leads_created ON Leads(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_blocked_dates ON Blocked_Dates(date);

-- Seed Data

INSERT INTO Admin_Settings (setting_key, setting_value) VALUES ('booking_enabled', 'true');
INSERT INTO Admin_Settings (setting_key, setting_value) VALUES ('timezone', 'America/New_York');
INSERT INTO Admin_Settings (setting_key, setting_value) VALUES ('pricing', '{"baseFee":0,"perPerson":0,"depositPercent":60}');
INSERT INTO Admin_Settings (setting_key, setting_value) VALUES ('profile', '{"bio":"","email":"","phone":"","location":"","travel":"","social":[]}');
INSERT INTO Admin_Settings (setting_key, setting_value) VALUES ('weekly_availability', '[{"day":"Monday","available":false,"timeframes":[]},{"day":"Tuesday","available":false,"timeframes":[]},{"day":"Wednesday","available":false,"timeframes":[]},{"day":"Thursday","available":false,"timeframes":[]},{"day":"Friday","available":false,"timeframes":[]},{"day":"Saturday","available":false,"timeframes":[]},{"day":"Sunday","available":false,"timeframes":[]}]');
