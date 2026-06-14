-- Track which vertical preset drives conversation playbooks
ALTER TABLE ai_config ADD COLUMN preset_id TEXT;

UPDATE _meta SET value = '0022', updated_at = datetime('now') WHERE key = 'schema_version';
