-- Service module: service periods, turn time rules, pacing rules,
-- availability exceptions. day_of_week uses the existing mon..sun codes
-- (see DAY_ORDER in src/db/location-schedules.ts).

CREATE TABLE IF NOT EXISTS service_periods (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  location_id TEXT NOT NULL REFERENCES locations(id),
  name TEXT NOT NULL,
  day_of_week TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  last_seating_time TEXT NOT NULL,
  slot_interval_min INTEGER,
  online_bookable INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_service_periods_day
  ON service_periods(location_id, day_of_week, is_active);

CREATE TABLE IF NOT EXISTS service_period_rooms (
  service_period_id TEXT NOT NULL REFERENCES service_periods(id) ON DELETE CASCADE,
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  PRIMARY KEY (service_period_id, room_id)
);

CREATE TABLE IF NOT EXISTS turn_time_rules (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  location_id TEXT NOT NULL REFERENCES locations(id),
  service_period_id TEXT REFERENCES service_periods(id) ON DELETE CASCADE,
  party_min INTEGER NOT NULL,
  party_max INTEGER NOT NULL,
  turn_minutes INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_turn_rules_location ON turn_time_rules(location_id);

CREATE TABLE IF NOT EXISTS pacing_rules (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  location_id TEXT NOT NULL REFERENCES locations(id),
  service_period_id TEXT REFERENCES service_periods(id) ON DELETE CASCADE,
  interval_min INTEGER NOT NULL DEFAULT 15,
  max_covers INTEGER,
  max_bookings INTEGER,
  applies_from TEXT,
  applies_to TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS availability_exceptions (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  location_id TEXT NOT NULL REFERENCES locations(id),
  service_date TEXT NOT NULL,
  kind TEXT NOT NULL,
  start_time TEXT,
  end_time TEXT,
  room_id TEXT REFERENCES rooms(id) ON DELETE CASCADE,
  table_id TEXT REFERENCES dining_tables(id) ON DELETE CASCADE,
  override_last_seating TEXT,
  note TEXT,
  created_by_staff_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_exceptions_date
  ON availability_exceptions(location_id, service_date);

UPDATE _meta SET value = '0035', updated_at = datetime('now')
WHERE key = 'schema_version' AND value < '0035';
