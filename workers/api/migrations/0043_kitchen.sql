-- Kitchen tablet plugin: menu + tickets (no printer yet).
CREATE TABLE IF NOT EXISTS menu_categories (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  location_id TEXT NOT NULL REFERENCES locations(id),
  name TEXT NOT NULL,
  station TEXT NOT NULL DEFAULT 'kitchen',
  sort_order INTEGER NOT NULL DEFAULT 100,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_menu_categories_location
  ON menu_categories(location_id, is_active, sort_order);

CREATE TABLE IF NOT EXISTS menu_items (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  location_id TEXT NOT NULL REFERENCES locations(id),
  category_id TEXT NOT NULL REFERENCES menu_categories(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  price_pence INTEGER NOT NULL DEFAULT 0,
  station TEXT NOT NULL DEFAULT 'kitchen',
  sort_order INTEGER NOT NULL DEFAULT 100,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_menu_items_category
  ON menu_items(category_id, is_active, sort_order);

CREATE TABLE IF NOT EXISTS kitchen_tickets (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  location_id TEXT NOT NULL REFERENCES locations(id),
  reservation_id TEXT REFERENCES reservations(id),
  table_label TEXT,
  station TEXT NOT NULL DEFAULT 'kitchen',
  status TEXT NOT NULL DEFAULT 'new',
  notes TEXT,
  created_by_staff_id TEXT REFERENCES staff_users(id),
  started_at TEXT,
  ready_at TEXT,
  served_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_kitchen_tickets_board
  ON kitchen_tickets(location_id, station, status, created_at);

CREATE TABLE IF NOT EXISTS kitchen_ticket_items (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL REFERENCES kitchen_tickets(id) ON DELETE CASCADE,
  menu_item_id TEXT REFERENCES menu_items(id),
  name TEXT NOT NULL,
  qty INTEGER NOT NULL DEFAULT 1,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'new',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_kitchen_ticket_items_ticket
  ON kitchen_ticket_items(ticket_id);

INSERT OR REPLACE INTO _meta (key, value, updated_at)
VALUES ('schema_version', '0043', datetime('now'));

-- Demo menu seed: workers/api/src/plugins/kitchen/seed.ts → seedKitchenMenu()
-- (Coffee/Bar + Mains categories; called from /admin/seed when ENABLE_KITCHEN=true)
