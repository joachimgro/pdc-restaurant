-- Reservations, holds, and the reservation event log.
--
-- contact_id is deliberately TEXT with no REFERENCES clause. The contacts
-- table belongs to the CRM lineage (0023-0033) and exists only on forks that
-- applied it; an FK here would make this migration fail on every fork that
-- did not. plugins/service/guests.ts probes for the table at runtime and is
-- the only writer of this column.

CREATE TABLE IF NOT EXISTS reservations (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  location_id TEXT NOT NULL REFERENCES locations(id),
  reference TEXT NOT NULL,
  contact_id TEXT,
  guest_name TEXT NOT NULL,
  guest_phone TEXT,
  guest_email TEXT,
  party_size INTEGER NOT NULL,
  service_date TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  starts_at_utc TEXT NOT NULL,
  service_period_id TEXT REFERENCES service_periods(id),
  room_id TEXT REFERENCES rooms(id),
  status TEXT NOT NULL DEFAULT 'confirmed',
  source TEXT NOT NULL DEFAULT 'online',
  assignment_locked INTEGER NOT NULL DEFAULT 0,
  occasion TEXT,
  allergies TEXT,
  guest_notes TEXT,
  staff_notes TEXT,
  tags_json TEXT,
  deposit_required_pence INTEGER NOT NULL DEFAULT 0,
  payment_id TEXT,
  seated_at TEXT,
  finished_at TEXT,
  cancelled_at TEXT,
  cancelled_by TEXT,
  cancel_reason TEXT,
  no_show_marked_at TEXT,
  marketing_opt_in INTEGER NOT NULL DEFAULT 0,
  created_by_staff_id TEXT REFERENCES staff_users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(organization_id, reference)
);
CREATE INDEX IF NOT EXISTS idx_reservations_service
  ON reservations(location_id, service_date, start_time);
CREATE INDEX IF NOT EXISTS idx_reservations_status
  ON reservations(location_id, service_date, status);
CREATE INDEX IF NOT EXISTS idx_reservations_contact
  ON reservations(organization_id, contact_id, starts_at_utc);
CREATE INDEX IF NOT EXISTS idx_reservations_upcoming
  ON reservations(organization_id, starts_at_utc, status);

CREATE TABLE IF NOT EXISTS reservation_tables (
  reservation_id TEXT NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
  table_id TEXT NOT NULL REFERENCES dining_tables(id),
  PRIMARY KEY (reservation_id, table_id)
);
CREATE INDEX IF NOT EXISTS idx_reservation_tables_table ON reservation_tables(table_id);

CREATE TABLE IF NOT EXISTS reservation_holds (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  location_id TEXT NOT NULL,
  service_date TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  party_size INTEGER NOT NULL,
  client_token_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  reservation_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_holds_live
  ON reservation_holds(location_id, service_date, expires_at, consumed_at);
CREATE INDEX IF NOT EXISTS idx_holds_token ON reservation_holds(client_token_hash);

CREATE TABLE IF NOT EXISTS reservation_hold_tables (
  hold_id TEXT NOT NULL REFERENCES reservation_holds(id) ON DELETE CASCADE,
  table_id TEXT NOT NULL REFERENCES dining_tables(id),
  PRIMARY KEY (hold_id, table_id)
);
CREATE INDEX IF NOT EXISTS idx_hold_tables_table ON reservation_hold_tables(table_id);

CREATE TABLE IF NOT EXISTS reservation_events (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  reservation_id TEXT NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  actor TEXT NOT NULL,
  data_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_reservation_events_res
  ON reservation_events(reservation_id, created_at);

-- Guarded so applying the 0023-0033 CRM lineage afterwards can never lower
-- the recorded version. The spec's INSERT OR REPLACE would overwrite it.
UPDATE _meta SET value = '0036', updated_at = datetime('now')
WHERE key = 'schema_version' AND value < '0036';
