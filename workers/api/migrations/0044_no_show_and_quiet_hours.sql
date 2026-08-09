-- No-show grace + configurable quiet hours for booking notifications.
ALTER TABLE venue_settings ADD COLUMN no_show_grace_min INTEGER NOT NULL DEFAULT 15;
ALTER TABLE venue_settings ADD COLUMN quiet_hours_start TEXT NOT NULL DEFAULT '21:00';
ALTER TABLE venue_settings ADD COLUMN quiet_hours_end TEXT NOT NULL DEFAULT '08:00';

INSERT OR REPLACE INTO _meta (key, value, updated_at)
VALUES ('schema_version', '0044', datetime('now'));
