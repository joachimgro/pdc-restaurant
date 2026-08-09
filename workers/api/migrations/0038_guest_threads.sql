-- 0038_guest_threads.sql
-- Guest contact threads for restaurant messaging. Never creates leads rows.
-- Timeline links booking notifications via guest_messages.notification_id.

CREATE TABLE IF NOT EXISTS guest_threads (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  location_id TEXT NOT NULL REFERENCES locations(id),
  reservation_id TEXT REFERENCES reservations(id) ON DELETE SET NULL,
  guest_name TEXT NOT NULL,
  guest_email TEXT,
  guest_phone TEXT,
  preview TEXT,
  last_message_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_guest_threads_org_last
  ON guest_threads(organization_id, last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_guest_threads_reservation
  ON guest_threads(reservation_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_guest_threads_email
  ON guest_threads(organization_id, guest_email)
  WHERE guest_email IS NOT NULL AND guest_email != '';

CREATE TABLE IF NOT EXISTS guest_messages (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES guest_threads(id) ON DELETE CASCADE,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  direction TEXT NOT NULL,
  channel TEXT NOT NULL,
  body TEXT NOT NULL,
  subject TEXT,
  notification_id TEXT,
  staff_user_id TEXT REFERENCES staff_users(id),
  status TEXT NOT NULL DEFAULT 'queued',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_guest_messages_thread
  ON guest_messages(thread_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_guest_messages_notification
  ON guest_messages(notification_id)
  WHERE notification_id IS NOT NULL;

INSERT OR REPLACE INTO _meta (key, value, updated_at)
VALUES ('schema_version', '0038', datetime('now'));
