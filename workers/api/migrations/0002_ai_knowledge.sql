-- AI persona and location context
CREATE TABLE IF NOT EXISTS ai_config (
  organization_id TEXT PRIMARY KEY REFERENCES organizations(id),
  academy_name TEXT NOT NULL,
  tone TEXT NOT NULL,
  goals TEXT NOT NULL,
  rules TEXT NOT NULL,
  model_reply TEXT NOT NULL DEFAULT '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
  model_judge TEXT NOT NULL DEFAULT '@cf/meta/llama-3.1-8b-instruct',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ai_location_overrides (
  location_id TEXT PRIMARY KEY REFERENCES locations(id),
  extra_context TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ai_ingest_meta (
  organization_id TEXT PRIMARY KEY REFERENCES organizations(id),
  chunk_count INTEGER NOT NULL DEFAULT 0,
  ingested_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- AI config is seeded via the Admin panel or via /admin/seed (when ENABLE_DEMO_TOOLS=true).
-- To bootstrap a new client, use the Admin panel → AI Config after first deploy,
-- or add INSERT OR IGNORE rows below if you prefer migration-based seeding.
--
-- Example (uncomment and fill in):
-- INSERT OR IGNORE INTO ai_config (
--   organization_id, academy_name, tone, goals, rules, model_reply, model_judge
-- ) VALUES (
--   'CHANGE_ME',                          -- match ORGANIZATION_ID in wrangler.toml
--   'TODO: Client Academy Name',
--   'Sound like a real person at the front desk — warm, upbeat, human. Use contractions. Never robotic.',
--   'Be genuinely helpful on every message. Answer what they said, then move one step forward toward a booking.',
--   'Under 300 characters. One clear next step per message. No medical advice. Only use prices/times from Knowledge.',
--   '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
--   '@cf/meta/llama-3.1-8b-instruct'
-- );
