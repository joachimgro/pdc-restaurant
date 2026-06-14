-- Phase 4 Fix 1: schema version tracking for deploy-time mismatch detection.
-- Establishes _meta.schema_version as the deployment contract going forward.
-- Does NOT retroactively version migrations 0001–0018; this migration is the baseline.

CREATE TABLE IF NOT EXISTS _meta (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO _meta (key, value) VALUES ('schema_version', '0000');

UPDATE _meta SET value = '0019', updated_at = datetime('now') WHERE key = 'schema_version';
