-- Service module core: venue settings, rooms, tables, combinations.
-- Numbering note: 0023-0033 are reserved for the CRM/Wix feature-branch
-- lineage (applied on client forks such as pdc-phiof). The schema_version
-- write below is guarded so applying those later can never lower the version.

CREATE TABLE IF NOT EXISTS venue_settings (
  location_id TEXT PRIMARY KEY REFERENCES locations(id),
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  timezone TEXT NOT NULL DEFAULT 'Europe/London',
  booking_slug TEXT UNIQUE,
  slot_interval_min INTEGER NOT NULL DEFAULT 15,
  default_turn_minutes INTEGER NOT NULL DEFAULT 90,
  grace_after_close_min INTEGER NOT NULL DEFAULT 30,
  min_party_online INTEGER NOT NULL DEFAULT 1,
  max_party_online INTEGER NOT NULL DEFAULT 8,
  large_party_message TEXT,
  min_lead_minutes INTEGER NOT NULL DEFAULT 60,
  max_advance_days INTEGER NOT NULL DEFAULT 90,
  hold_ttl_seconds INTEGER NOT NULL DEFAULT 600,
  auto_assign_tables INTEGER NOT NULL DEFAULT 1,
  allow_online_waitlist INTEGER NOT NULL DEFAULT 1,
  cancellation_window_hours INTEGER NOT NULL DEFAULT 24,
  brand_json TEXT,
  contact_phone TEXT,
  contact_email TEXT,
  address_text TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS rooms (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  location_id TEXT NOT NULL REFERENCES locations(id),
  name TEXT NOT NULL,
  accent_color TEXT,
  online_bookable INTEGER NOT NULL DEFAULT 1,
  canvas_width INTEGER NOT NULL DEFAULT 1200,
  canvas_height INTEGER NOT NULL DEFAULT 800,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_rooms_location ON rooms(location_id, sort_order);

CREATE TABLE IF NOT EXISTS dining_tables (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  location_id TEXT NOT NULL REFERENCES locations(id),
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  seats_min INTEGER NOT NULL DEFAULT 1,
  seats_max INTEGER NOT NULL,
  shape TEXT NOT NULL DEFAULT 'round',
  pos_x INTEGER NOT NULL DEFAULT 0,
  pos_y INTEGER NOT NULL DEFAULT 0,
  width INTEGER NOT NULL DEFAULT 90,
  height INTEGER NOT NULL DEFAULT 90,
  rotation INTEGER NOT NULL DEFAULT 0,
  online_bookable INTEGER NOT NULL DEFAULT 1,
  assign_priority INTEGER NOT NULL DEFAULT 100,
  is_active INTEGER NOT NULL DEFAULT 1,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(location_id, label)
);
CREATE INDEX IF NOT EXISTS idx_dining_tables_room ON dining_tables(room_id, is_active);
CREATE INDEX IF NOT EXISTS idx_dining_tables_location ON dining_tables(location_id, is_active);

CREATE TABLE IF NOT EXISTS table_combinations (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  location_id TEXT NOT NULL REFERENCES locations(id),
  label TEXT NOT NULL,
  seats_min INTEGER NOT NULL,
  seats_max INTEGER NOT NULL,
  assign_priority INTEGER NOT NULL DEFAULT 300,
  online_bookable INTEGER NOT NULL DEFAULT 1,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS table_combination_members (
  combination_id TEXT NOT NULL REFERENCES table_combinations(id) ON DELETE CASCADE,
  table_id TEXT NOT NULL REFERENCES dining_tables(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (combination_id, table_id)
);
CREATE INDEX IF NOT EXISTS idx_combo_members_table ON table_combination_members(table_id);

UPDATE _meta SET value = '0034', updated_at = datetime('now')
WHERE key = 'schema_version' AND value < '0034';
