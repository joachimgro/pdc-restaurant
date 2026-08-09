-- Dining guest profiles (VIP, reliability). Keyed by contact; never creates leads.
CREATE TABLE IF NOT EXISTS guest_profiles (
  contact_id TEXT PRIMARY KEY REFERENCES contacts(id) ON DELETE CASCADE,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  vip INTEGER NOT NULL DEFAULT 0,
  allergies TEXT,
  dietary TEXT,
  seating_preference TEXT,
  notes TEXT,
  visit_count INTEGER NOT NULL DEFAULT 0,
  no_show_count INTEGER NOT NULL DEFAULT 0,
  cancel_count INTEGER NOT NULL DEFAULT 0,
  lifetime_covers INTEGER NOT NULL DEFAULT 0,
  reliability_score INTEGER NOT NULL DEFAULT 100,
  last_visit_at TEXT,
  first_visit_at TEXT,
  marketing_opt_in INTEGER NOT NULL DEFAULT 0,
  marketing_opt_in_at TEXT,
  blocked INTEGER NOT NULL DEFAULT 0,
  blocked_reason TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_guest_profiles_vip
  ON guest_profiles(organization_id, vip) WHERE vip = 1;
CREATE INDEX IF NOT EXISTS idx_guest_profiles_org
  ON guest_profiles(organization_id);

-- Combined online party cap when table combinations can seat larger parties.
ALTER TABLE venue_settings ADD COLUMN max_party_combined INTEGER NOT NULL DEFAULT 12;
ALTER TABLE venue_settings ADD COLUMN review_url TEXT;
ALTER TABLE venue_settings ADD COLUMN review_request_delay_hours INTEGER NOT NULL DEFAULT 4;

INSERT OR REPLACE INTO _meta (key, value, updated_at)
VALUES ('schema_version', '0041', datetime('now'));
