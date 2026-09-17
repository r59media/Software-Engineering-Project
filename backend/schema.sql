-- schema.sql

DROP TABLE IF EXISTS Bookings;
DROP TABLE IF EXISTS Leads;
DROP TABLE IF EXISTS Schedule_Slots;
DROP TABLE IF EXISTS Admin_Settings;
DROP TABLE IF EXISTS Portfolio_Images;
DROP TABLE IF EXISTS Services;

CREATE TABLE Services (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    price INTEGER NOT NULL, -- Stored in cents
    duration_minutes INTEGER NOT NULL,
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
    slot_id INTEGER NOT NULL UNIQUE,
    client_name TEXT NOT NULL,
    client_email TEXT NOT NULL,
    price_at_booking INTEGER NOT NULL, -- Stored in cents
    square_payment_id TEXT UNIQUE,
    status TEXT DEFAULT 'pending', -- pending, confirmed, cancelled
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
    r2_object_key TEXT NOT NULL UNIQUE,
    category TEXT DEFAULT 'All',
    alt_text TEXT,
    display_order INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT 1,
    is_featured BOOLEAN DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Performance Indexes
CREATE INDEX idx_slots_availability ON Schedule_Slots(date, is_booked);
CREATE INDEX idx_portfolio_active ON Portfolio_Images(is_active, display_order);
CREATE INDEX idx_services_active ON Services(is_active);
CREATE INDEX idx_bookings_slot ON Bookings(slot_id);

-- Seed Data
INSERT INTO Services (name, description, price, duration_minutes) VALUES ('Portrait Session', 'A standard 1-hour portrait session.', 25000, 60);
INSERT INTO Services (name, description, price, duration_minutes) VALUES ('Wedding Package', 'Full day wedding coverage.', 150000, 480);

INSERT INTO Admin_Settings (setting_key, setting_value) VALUES ('booking_enabled', 'true');
INSERT INTO Admin_Settings (setting_key, setting_value) VALUES ('timezone', 'America/New_York');
