-- Auth tables: admins, magic_links, sessions
-- Tokens are stored as SHA-256 hashes — raw tokens are never persisted.

CREATE TABLE IF NOT EXISTS admins (
  email      TEXT PRIMARY KEY,
  added_by   TEXT,           -- email of the admin who invited this one, or 'system'
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS magic_links (
  token_hash TEXT PRIMARY KEY,  -- SHA-256 hex of the raw token
  email      TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at    TEXT              -- NULL = still valid; set on first use
);

CREATE INDEX IF NOT EXISTS idx_magic_links_email ON magic_links(email);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,  -- SHA-256 hex of the raw session token
  email      TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sessions_email ON sessions(email);

-- Super admin — always present, cannot be removed via the API.
-- SUPER_ADMIN_EMAIL in wrangler.toml must match this value.
INSERT OR IGNORE INTO admins (email, added_by)
VALUES ('justphiof@gmail.com', 'system');
