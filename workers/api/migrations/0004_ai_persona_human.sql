-- Improved AI persona defaults — applied to all future ai_config inserts via DEFAULT_CONFIG in code.
-- This migration is a no-op on a fresh template (no ai_config rows exist yet).
-- Configure your AI persona via Admin panel → AI Config after first deploy,
-- or seed via the INSERT block in 0002_ai_knowledge.sql.

-- (intentionally empty — persona defaults are in workers/api/src/db/ai-config.ts)
