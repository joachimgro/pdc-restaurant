-- Guest thread moderation (flag / mute) for staff triage.
ALTER TABLE guest_threads ADD COLUMN flagged_at TEXT;
ALTER TABLE guest_threads ADD COLUMN flag_reason TEXT;
ALTER TABLE guest_threads ADD COLUMN muted_at TEXT;
ALTER TABLE guest_messages ADD COLUMN flagged INTEGER NOT NULL DEFAULT 0;

INSERT OR REPLACE INTO _meta (key, value, updated_at)
VALUES ('schema_version', '0042', datetime('now'));
