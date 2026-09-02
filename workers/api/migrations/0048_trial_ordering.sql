-- Trial ordering: courses, availability, choices, batch order_key.
-- menu_categories.station and menu_items.station already exist (0043).

ALTER TABLE menu_categories ADD COLUMN default_course TEXT;

ALTER TABLE menu_items ADD COLUMN available INTEGER NOT NULL DEFAULT 1;
ALTER TABLE menu_items ADD COLUMN unavailable_at TEXT;
ALTER TABLE menu_items ADD COLUMN choices TEXT;

ALTER TABLE kitchen_tickets ADD COLUMN serve_mode TEXT;
ALTER TABLE kitchen_tickets ADD COLUMN covers INTEGER;
ALTER TABLE kitchen_tickets ADD COLUMN order_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS kitchen_tickets_order_key
  ON kitchen_tickets(organization_id, order_key, station)
  WHERE order_key IS NOT NULL;

ALTER TABLE kitchen_ticket_items ADD COLUMN course TEXT;

INSERT OR REPLACE INTO _meta (key, value, updated_at)
VALUES ('schema_version', '0048', datetime('now'));
