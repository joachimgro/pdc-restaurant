-- Per-org AI qualification templates and field labels (JSON in TEXT columns).
ALTER TABLE ai_config ADD COLUMN qualification_enabled INTEGER NOT NULL DEFAULT 1;
ALTER TABLE ai_config ADD COLUMN required_fields TEXT;
ALTER TABLE ai_config ADD COLUMN field_labels TEXT;
ALTER TABLE ai_config ADD COLUMN programme_aliases TEXT;
ALTER TABLE ai_config ADD COLUMN qualification_templates TEXT;

UPDATE _meta SET value = '0021', updated_at = datetime('now') WHERE key = 'schema_version';
