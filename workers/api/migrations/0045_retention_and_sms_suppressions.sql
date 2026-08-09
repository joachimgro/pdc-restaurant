-- Compliance: retention window + SMS suppression list.
-- Status: see git.

ALTER TABLE venue_settings ADD COLUMN retention_months INTEGER NOT NULL DEFAULT 24;

CREATE TABLE IF NOT EXISTS sms_suppressions (
  organization_id TEXT NOT NULL,
  phone_e164 TEXT NOT NULL,
  suppressed_at TEXT NOT NULL DEFAULT (datetime('now')),
  source TEXT NOT NULL DEFAULT 'stop',
  PRIMARY KEY (organization_id, phone_e164)
);

CREATE INDEX IF NOT EXISTS idx_sms_suppressions_org
  ON sms_suppressions (organization_id);

INSERT OR REPLACE INTO _meta (key, value, updated_at)
VALUES ('schema_version', '0045', datetime('now'));
