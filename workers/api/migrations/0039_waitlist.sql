-- Waitlist queue (walk-in + date waitlist). Position is computed, never stored.
CREATE TABLE IF NOT EXISTS waitlist_entries (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  location_id TEXT NOT NULL REFERENCES locations(id),
  contact_id TEXT REFERENCES contacts(id),
  guest_name TEXT NOT NULL,
  guest_phone TEXT,
  guest_email TEXT,
  party_size INTEGER NOT NULL,
  kind TEXT NOT NULL DEFAULT 'walk_in',
  service_date TEXT NOT NULL,
  requested_from TEXT,
  requested_to TEXT,
  status TEXT NOT NULL DEFAULT 'waiting',
  quoted_wait_min INTEGER,
  priority INTEGER NOT NULL DEFAULT 100,
  joined_at TEXT NOT NULL DEFAULT (datetime('now')),
  notified_at TEXT,
  notify_expires_at TEXT,
  notify_count INTEGER NOT NULL DEFAULT 0,
  seated_at TEXT,
  removed_at TEXT,
  removed_reason TEXT,
  reservation_id TEXT REFERENCES reservations(id),
  notes TEXT,
  created_by_staff_id TEXT REFERENCES staff_users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_waitlist_queue
  ON waitlist_entries(location_id, service_date, status, priority, joined_at);
CREATE INDEX IF NOT EXISTS idx_waitlist_contact
  ON waitlist_entries(organization_id, contact_id);

INSERT OR REPLACE INTO _meta (key, value, updated_at)
VALUES ('schema_version', '0039', datetime('now'));
