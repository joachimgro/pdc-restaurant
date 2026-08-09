-- Ensure contacts CRM tables exist on forks that skipped 0029/0030.
-- Idempotent: safe when tables already exist on a stamped D1.

CREATE TABLE IF NOT EXISTS contacts (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  name TEXT NOT NULL,
  phone_e164 TEXT NOT NULL,
  email TEXT,
  lifecycle TEXT NOT NULL DEFAULT 'new',
  source_first_seen TEXT,
  source_last_seen TEXT,
  primary_lead_id TEXT,
  location_id TEXT,
  interest TEXT,
  child_json TEXT,
  last_message_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(organization_id, phone_e164)
);

CREATE INDEX IF NOT EXISTS idx_contacts_org_lifecycle
  ON contacts(organization_id, lifecycle);

CREATE INDEX IF NOT EXISTS idx_contacts_org_last_message
  ON contacts(organization_id, last_message_at);

CREATE TABLE IF NOT EXISTS contact_identifiers (
  id TEXT PRIMARY KEY,
  contact_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  type TEXT NOT NULL,
  value TEXT NOT NULL,
  label TEXT,
  is_primary INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE CASCADE,
  UNIQUE(organization_id, type, value)
);

CREATE INDEX IF NOT EXISTS idx_contact_identifiers_contact
  ON contact_identifiers(contact_id);

CREATE INDEX IF NOT EXISTS idx_contact_identifiers_lookup
  ON contact_identifiers(organization_id, type, value);

INSERT OR REPLACE INTO _meta (key, value, updated_at)
VALUES ('schema_version', '0046', datetime('now'));
