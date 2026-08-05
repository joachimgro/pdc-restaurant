-- 0037_notifications.sql
-- Next sequential after 0036. Waitlist/payments are NOT reserved numbers;
-- they will be 0038+ when those phases land.
--
-- waitlist_entry_id is nullable TEXT with NO FOREIGN KEY: waitlist_entries
-- does not exist until Phase 7. Soft reference only; do not add FK here.

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  location_id TEXT NOT NULL REFERENCES locations(id),
  reservation_id TEXT REFERENCES reservations(id) ON DELETE CASCADE,
  waitlist_entry_id TEXT,
  channel TEXT NOT NULL,
  template TEXT NOT NULL,
  to_address TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled',
  scheduled_for TEXT,
  sent_at TEXT,
  provider_message_id TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  error_text TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  payload_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_notifications_due
  ON notifications(status, scheduled_for);
CREATE INDEX IF NOT EXISTS idx_notifications_reservation
  ON notifications(reservation_id);

CREATE TABLE IF NOT EXISTS guest_access_tokens (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  reservation_id TEXT REFERENCES reservations(id) ON DELETE CASCADE,
  waitlist_entry_id TEXT,
  token_hash TEXT NOT NULL UNIQUE,
  scope TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  uses INTEGER NOT NULL DEFAULT 0,
  max_uses INTEGER,
  last_used_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_guest_tokens_res ON guest_access_tokens(reservation_id);

-- Guest reserve retries: same Idempotency-Key returns the same reservation.
ALTER TABLE reservations ADD COLUMN idempotency_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_reservations_idempotency
  ON reservations(organization_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

INSERT OR REPLACE INTO _meta (key, value, updated_at)
VALUES ('schema_version', '0037', datetime('now'));
