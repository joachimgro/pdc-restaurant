-- M8: venue-configurable waitlist notify TTL (minutes).
ALTER TABLE venue_settings ADD COLUMN waitlist_notify_ttl_min INTEGER NOT NULL DEFAULT 10;

INSERT OR REPLACE INTO _meta (key, value, updated_at)
VALUES ('schema_version', '0047', datetime('now'));
