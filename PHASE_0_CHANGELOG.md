# Phase 0 Changelog — Code/Config Boundary

Enforces the principle that client-specific values live in D1 (via Admin), not in committed
source files. Every change below removes a known merge-conflict vector or hardcoded client default.

---

## Migrations

### `workers/api/migrations/0015_phase0_config_boundary.sql`
- Added `ai_config.safe_fallback_message` and `ai_config.intake_context_label` columns.
- Rebuilt `leads` table so `location_id` is nullable — inbound SMS no longer FK-fails when an org
  has zero locations configured.

---

## Packages

### `packages/knowledge/src/index.ts`
- Emptied `KNOWLEDGE_CHUNKS` to `[]` with a comment directing operators to Admin → Knowledge.
- **Why:** Per-client knowledge in git caused merge conflicts on every `git merge upstream/main`.

### `packages/seed-data/src/leads.ts`
- Emptied `LOCATIONS` to `[]` with a comment directing operators to Admin → Locations.
- **Why:** Same merge-conflict problem as knowledge chunks.

---

## Worker — database layer

### `workers/api/src/db/locations.ts` (new)
- `getDefaultLocation()` — first org location by `created_at`, or `null`.
- `getOrgLocations()` — all locations for the org.
- `countOrgLocations()` — used by seed logic.
- `getLocationNameById()` / `resolveLocationIdFromText()` — D1-backed location resolution.

### `workers/api/src/db/inbound-sms.ts`
- Removed hardcoded `"manchester"` default.
- Uses `getDefaultLocation()` when no location is provided; creates lead with `location_id = null`
  and logs a warning when no locations exist.
- **Why:** Non-Manchester clients were getting FK violations on every inbound SMS.

### `workers/api/src/db/seed.ts`
- Skips bundled `LOCATIONS` when D1 already has locations.
- Inserts from bundled array only if D1 is empty and bundled array is non-empty (mid-migration compat).
- Logs a clear warning when no locations are configured.

### `workers/api/src/db/leads.ts`
- `location_id` nullable in `LeadRow`; `getLocationName()` returns `"Unassigned"` when null.
- `listLeadsSummaries` uses `LEFT JOIN` so leads without a location still appear.

### `workers/api/src/db/ai-config.ts`
- Added `safe_fallback_message` and `intake_context_label` to `AiConfigRow`.
- Replaced martial-arts-specific `DEFAULT_CONFIG` with generic industry-neutral fallbacks.
- `getAiConfig()` logs `console.warn` with org ID when no D1 row exists.
- Added `getSafeFallbackMessage()`, `intakeContextLabelFromConfig()`.

### `workers/api/src/db/knowledge-chunks.ts`
- No code change required — `collectChunksForIngest()` already reads D1 portal/schedule chunks
  first, then bundled chunks (now empty in template).

---

## Worker — routes

### `workers/api/src/routes/admin.ts`
- Replaced hardcoded `syncAllSchedulesForLocation(env, "bolton")` with a loop over
  `getOrgLocations()`.
- Logs warning and skips when no locations exist.

### `workers/api/src/routes/leads.ts`
- Changed simulate timeline label from `"Referral SMS"` to `"Simulated lead"`.

---

## Worker — AI layer

### `workers/api/src/ai/stub.ts`
- Removed hardcoded `SMS_SAFE_FALLBACK` constant (callers use `getSafeFallbackMessage()`).

### `workers/api/src/ai/judge.ts`
- Uses `await getSafeFallbackMessage(env)` instead of hardcoded fallback string.

### `workers/api/src/ai/context.ts`
- `buildStructuredHistory()` / `buildStructuredHistoryForLlm()` accept configurable
  `intakeContextLabel` (from `ai_config.intake_context_label` with generic fallback).

### `workers/api/src/ai/pipeline.ts` / `workers/api/src/ai/preview.ts`
- Pass `intakeContextLabelFromConfig(ctx.aiConfig)` into history builder.

### `workers/api/src/ai/qualification.ts`
- Removed hardcoded `LOCATION_ALIASES` / `LOCATION_NAMES` (manchester, bolton, etc.).
- Location matching now uses `resolveLocationIdFromText()` against D1-configured locations.

### `workers/api/src/ai/intake-context.ts`
- Removed hardcoded `BRANCH_CITIES` and per-city `SCHEDULE_FALLBACK` maps.
- Schedule lines now come from D1 schedules, RAG chunks, or a generic fallback string.

---

## Docs & scripts

### `docs/knowledge-guide.md`
- Rewritten to document Admin → Knowledge as the sole production path for chunks.

### `scripts/deploy-remote.sh`
- Post-deploy steps now reference Admin panel for locations and knowledge (not git files).

---

## Verification results

| Check | Status |
|---|---|
| `KNOWLEDGE_CHUNKS` is `[]` | ✓ |
| `LOCATIONS` is `[]` | ✓ |
| No `"manchester"` / `"bolton"` in `workers/api/src/` | ✓ |
| Migration `0015` applies cleanly (SQLite test) | ✓ |
| Worker TypeScript (`tsc --noEmit`) | ✓ |
| `pnpm db:migrate:local` | ⚠ Blocked by pre-existing `name = "pdc-CHANGE_ME"` in `wrangler.toml` (invalid wrangler name until client slug is set) — migration SQL itself is valid |
| `pnpm dev:worker` | Not run (same `wrangler.toml` placeholder) |

---

## Follow-ups (out of scope for Phase 0)

1. **Knowledge chunk edit UI** — Admin supports create + delete (`KnowledgePanel`, `knowledge-admin.ts`) but no update/edit endpoint. Operators must delete and re-create to change a chunk.
2. **KnowledgePanel location dropdown** — `apps/web/src/components/inbox/KnowledgePanel.tsx` still hardcodes Manchester/Leeds/Bolton/Stockport in the location picker; should load from `/admin/locations` API.
3. **AI Config admin UI** — New `safe_fallback_message` and `intake_context_label` columns exist in D1 but are not exposed in `ai-admin.ts` GET response or Admin UI; set via D1 SQL until UI is extended.
4. **LocationRail** — `apps/web/src/components/inbox/LocationRail.tsx` has hardcoded location list (display-only filter; separate from worker boundary).
5. **`wrangler.toml` placeholders** — Client must set `name`, `account_id`, `database_id` before local migrate/dev works.

---

## What a new client deployment now requires

After deploy and `pnpm db:migrate:remote`, an operator must complete these Admin panel steps
(nothing is seeded from git anymore):

1. **Locations** — Admin → Locations: create every branch/venue (slug, name, abbrev). Required
   before inbound SMS can assign a default location, and before schedule sync runs on seed.

2. **Knowledge** — Admin → Knowledge: add chunks for conversation style, pricing, programmes,
   per-location details, FAQ, etc. Click **Re-ingest Knowledge** (or `POST /admin/ingest-knowledge`)
   to index into Vectorize.

3. **AI persona** — Admin → AI Config: set academy name, tone, goals, and rules. Until a row
   exists in `ai_config`, the worker logs a warning and uses generic defaults.

4. **Optional D1 fields** (via SQL or future Admin UI):
   - `ai_config.safe_fallback_message` — SMS sent when the judge blocks a reply.
   - `ai_config.intake_context_label` — synthetic first user turn for website-form leads.

5. **Schedules** — Admin → Locations → per-location programme schedules (synced to knowledge
   chunks automatically on save).

6. **Twilio / webhooks** — Configure per `workers/api/TWILIO.md` and set `NEXT_PUBLIC_API_URL`.

Without steps 1–3, the system degrades gracefully (warnings in logs, generic AI behaviour) but is
not production-ready.

---

## Phase 0 follow-up — migration `0008` FK fix

### `workers/api/migrations/0008_fix_location_overrides.sql`
- **Removed** `INSERT OR REPLACE INTO ai_location_overrides` rows for hardcoded slugs
  (`manchester`, `leeds`, `bolton`, `stockport`).
- **Why:** Fresh client D1 databases have no `locations` rows at migration time, so these INSERTs
  failed with `FOREIGN KEY constraint failed` and halted the entire migration chain. This was a
  Phase 0 violation — client-specific location copy in a committed migration.
- **Now:** No-op with comment; `ai_location_overrides` DDL remains in `0002_ai_knowledge.sql`;
  per-location context is configured per client via Admin / application code.
- **Note:** Databases that already applied the old `0008` are unchanged (migration not re-run).
  See `PHASE_0_FOLLOWUP.md` for a full audit of other migration INSERTs.
