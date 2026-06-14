-- Phase 4 Fix 4: compound index for SSE event polling.
-- Queries filter WHERE organization_id = ? AND created_at > ? (see db/events.ts).

CREATE INDEX IF NOT EXISTS idx_domain_events_org_created
  ON domain_events(organization_id, created_at);

UPDATE _meta SET value = '0020', updated_at = datetime('now') WHERE key = 'schema_version';
