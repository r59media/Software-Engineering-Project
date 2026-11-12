-- Migration 0003: Add Login_Attempts table and ensure Revoked_Sessions
CREATE TABLE IF NOT EXISTS Login_Attempts (
  bucket TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL,
  window_start INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS Revoked_Sessions (
  signature TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_revoked_sessions_exp ON Revoked_Sessions(expires_at);
