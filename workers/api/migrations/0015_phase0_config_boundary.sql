-- Phase 0: move client-specific strings to D1; allow leads without a location

ALTER TABLE ai_config ADD COLUMN safe_fallback_message TEXT;
ALTER TABLE ai_config ADD COLUMN intake_context_label TEXT;

-- Inbound SMS must not FK-fail when no locations are configured yet
PRAGMA foreign_keys = OFF;

CREATE TABLE leads_new (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  location_id TEXT REFERENCES locations(id),
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  time_label TEXT NOT NULL,
  status TEXT NOT NULL,
  status_label TEXT NOT NULL,
  assessment TEXT NOT NULL,
  preview TEXT NOT NULL,
  unread INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL,
  interest TEXT NOT NULL,
  child_json TEXT,
  list_group TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  ai_paused INTEGER NOT NULL DEFAULT 0,
  just_arrived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  trial_slot TEXT,
  trial_slot_label TEXT,
  trial_proposed_json TEXT,
  trial_confirmed_at TEXT,
  location_confirmed INTEGER NOT NULL DEFAULT 1,
  notes TEXT
);

INSERT INTO leads_new SELECT * FROM leads;

DROP TABLE leads;

ALTER TABLE leads_new RENAME TO leads;

CREATE INDEX IF NOT EXISTS idx_leads_org ON leads(organization_id);
CREATE INDEX IF NOT EXISTS idx_leads_location ON leads(location_id);
CREATE INDEX IF NOT EXISTS idx_leads_phone ON leads(phone);

PRAGMA foreign_keys = ON;
