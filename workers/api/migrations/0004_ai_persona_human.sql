-- Improved AI persona defaults live in workers/api/src/db/ai-config.ts (DEFAULT_CONFIG).
-- This migration is a no-op on a fresh template (no ai_config rows exist yet).
-- Configure your AI persona via the Admin panel -> AI Config after first deploy,
-- or seed via the INSERT block in 0002_ai_knowledge.sql.

-- (intentionally empty — persona defaults are applied in code)
