-- schema.sql

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
    best_for TEXT,
    image_url TEXT,
    image_alt TEXT,
    price INTEGER, -- Stored in cents (null for custom pricing / inquiry)
    duration_minutes INTEGER, -- Duration in minutes (null for custom scope)
    photo_count INTEGER,
    outfits INTEGER,
    currency TEXT DEFAULT 'USD',
    booking_mode TEXT DEFAULT 'direct', -- 'direct' or 'inquiry'
    additional_people TEXT, -- JSON string for { includedPeople, maxPeople, extraPersonPriceMinor }
    display_order INTEGER DEFAULT 0,
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
    service_id INTEGER NOT NULL,
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
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (service_id) REFERENCES Services(id),
    FOREIGN KEY (slot_id) REFERENCES Schedule_Slots(id)
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
CREATE INDEX IF NOT EXISTS idx_services_active_order ON Services(is_active, display_order);
CREATE INDEX IF NOT EXISTS idx_bookings_slot ON Bookings(slot_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_bookings_active_slot ON Bookings(slot_id) WHERE status != 'cancelled';
CREATE INDEX IF NOT EXISTS idx_bookings_service ON Bookings(service_id);
CREATE INDEX IF NOT EXISTS idx_bookings_created ON Bookings(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_leads_created ON Leads(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_blocked_dates ON Blocked_Dates(date);

-- Seed Data
INSERT INTO Services (name, description, best_for, duration_minutes, photo_count, outfits, price, currency, booking_mode, additional_people, display_order)
VALUES ('Portrait', 'Individual headshots and portraits that feel like you.', 'LinkedIn, resumes & personal branding', 60, 5, 1, 6000, 'USD', 'direct', '{"includedPeople":1}', 1);

INSERT INTO Services (name, description, best_for, duration_minutes, photo_count, outfits, price, currency, booking_mode, additional_people, display_order)
VALUES ('Grad Pics', 'Celebrate your achievement with photos made for you.', 'Graduation announcements & keepsakes', 120, 10, 2, 15000, 'USD', 'direct', '{"includedPeople":1}', 2);

INSERT INTO Services (name, description, best_for, duration_minutes, photo_count, outfits, price, currency, booking_mode, additional_people, display_order)
VALUES ('Branding Pics', 'A focused session to bring your personal brand to life.', 'Creators & entrepreneurs', 120, 15, NULL, 23000, 'USD', 'direct', NULL, 3);

INSERT INTO Services (name, description, best_for, duration_minutes, photo_count, outfits, price, currency, booking_mode, additional_people, display_order)
VALUES ('Event', 'Capture the people, details and moments that matter.', 'Celebrations & special occasions', 300, 300, NULL, 70000, 'USD', 'direct', NULL, 4);

INSERT INTO Services (name, description, best_for, duration_minutes, photo_count, outfits, price, currency, booking_mode, additional_people, display_order)
VALUES ('Business package', 'Photography tailored to your team, business and goals.', 'Teams & business content', NULL, NULL, NULL, NULL, 'USD', 'inquiry', NULL, 5);

INSERT INTO Admin_Settings (setting_key, setting_value) VALUES ('booking_enabled', 'true');
INSERT INTO Admin_Settings (setting_key, setting_value) VALUES ('timezone', 'America/New_York');
INSERT INTO Admin_Settings (setting_key, setting_value) VALUES ('pricing', '{"baseFee":0,"perPerson":0,"depositPercent":50}');
INSERT INTO Admin_Settings (setting_key, setting_value) VALUES ('profile', '{"bio":"","email":"","phone":"","location":"","travel":"","social":[]}');
INSERT INTO Admin_Settings (setting_key, setting_value) VALUES ('weekly_availability', '[{"day":"Monday","available":false,"timeframes":[]},{"day":"Tuesday","available":false,"timeframes":[]},{"day":"Wednesday","available":false,"timeframes":[]},{"day":"Thursday","available":false,"timeframes":[]},{"day":"Friday","available":false,"timeframes":[]},{"day":"Saturday","available":false,"timeframes":[]},{"day":"Sunday","available":false,"timeframes":[]}]');
