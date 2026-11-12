ALTER TABLE Bookings ADD COLUMN photo_permission_portfolio BOOLEAN DEFAULT 0;
ALTER TABLE Bookings ADD COLUMN photo_permission_social BOOLEAN DEFAULT 0;
ALTER TABLE Bookings ADD COLUMN photo_permission_accepted_at TEXT;
ALTER TABLE Bookings ADD COLUMN photo_permission_version TEXT DEFAULT 'v1';
