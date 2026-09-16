-- schema.sql

DROP TABLE IF EXISTS Bookings;
DROP TABLE IF EXISTS Leads;
DROP TABLE IF EXISTS Schedule_Slots;
DROP TABLE IF EXISTS Admin_Settings;

CREATE TABLE Leads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
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
    client_name TEXT NOT NULL,
    client_email TEXT NOT NULL,
    slot_id INTEGER NOT NULL,
    service_type TEXT NOT NULL,
    price INTEGER NOT NULL, -- Stored in cents
    status TEXT DEFAULT 'pending', -- pending, confirmed, cancelled
    square_payment_id TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (slot_id) REFERENCES Schedule_Slots(id)
);

CREATE TABLE Admin_Settings (
    setting_key TEXT PRIMARY KEY,
    setting_value TEXT NOT NULL
);

CREATE TABLE Portfolio_Images (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    r2_object_key TEXT NOT NULL,
    display_order INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Default settings
INSERT INTO Admin_Settings (setting_key, setting_value) VALUES ('base_price', '15000'); -- $150
