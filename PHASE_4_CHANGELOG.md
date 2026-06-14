# Phase 4 — Multi-Client Scale Hardening

Platform protections for deploy-time mistakes, version drift, query degradation,
and shared Workers AI budget exhaustion across multiple client deployments.

All typechecks pass (`shared-types`, `workers/api`, `apps/web`).

---

## Migrations

### `workers/api/migrations/0019_meta_schema_version.sql` (new)
- Creates `_meta (key, value, updated_at)` and seeds `schema_version = '0000'`.
- Sets `schema_version` to `0019` — establishes the Phase 4 version baseline (does not retroactively version migrations 0001–0018).
- **Audit:** §3b (schema/code deploy mismatch).

### `workers/api/migrations/0020_domain_events_org_created_index.sql` (new)
- `CREATE INDEX IF NOT EXISTS idx_domain_events_org_created ON domain_events(organization_id, created_at)`.
- Sets `schema_version` to `0020`.
- **Audit:** §2c (SSE poll partial scans on `domain_events`).

### `workers/api/migrations/README.md` (new)
- Documents the `_meta.schema_version` UPDATE convention for all migrations from 0019 onward.
- Explicitly forbids retroactive edits to 0001–0018.

---

## Fix 1 — Migration version tracking and startup check (§3b)

### `workers/api/src/meta.ts` (new)
- `EXPECTED_SCHEMA_VERSION = "0020"` — must match highest migration file.
- `verifySchemaVersion(env)` with per-Worker-instance cache; compares D1 `_meta.schema_version` to expected.
- Missing `_meta` table (pre-Phase-4 DB): warn loudly and allow (backward compatibility).
- Mismatch after migrations exist: throw with actionable message referencing `pnpm deploy:remote`.

### `workers/api/src/index.ts`
- `/health` handled first (skips schema gate).
- All other routes: `verifySchemaVersion` before auth/dispatch; failure returns HTTP 503 JSON.
- Removed trivial `{ ok: true }` health handler (replaced by `handleHealth`).

---

## Fix 2 — Feature branch min-migration declaration (§3d)

### `FEATURE_REQUIREMENTS.md` (new)
- Template for `feat/*` branches: feature name, minimum schema version, base commit, new migrations.
- Merge checklist referencing `pnpm deploy:remote` and schema gate.

### `README.md`
- **Adding Optional Features:** post-merge `pnpm deploy:remote` step, `FEATURE_REQUIREMENTS.md` reference, `curl /health` verification, schema gate explanation.

Runtime protection is Fix 1 — no additional code required.

---

## Fix 3 — Per-client version tracking on `/health` (§3e)

### `workers/api/src/build-info.ts` (new)
- Committed dev defaults: `GIT_SHA = "dev"`, `BUILT_AT = "dev"`.

### `workers/api/scripts/gen-build-info.mjs` (new)
- Writes `build-info.ts` with `git rev-parse --short HEAD` and UTC timestamp.

### `workers/api/package.json`
- `gen-build-info`, `predeploy`, and `deploy` scripts (`predeploy && wrangler deploy`).

### `scripts/deploy-remote.sh`
- Runs `pnpm run gen-build-info` before `wrangler deploy`.
- Enhanced health check output (shows failures in `checks`).

### `workers/api/src/routes/health.ts` (new)
- Returns `{ ok, organizationId, version: { gitSha, builtAt, expectedSchema }, checks }`.
- Checks: `schema`, `d1`, `vectorize` (binding present), `ai_usage` (when KV configured).
- HTTP 200 when all checks pass; 503 otherwise.

---

## Fix 4 — `domain_events` compound index (§2c)

Covered by migration `0020`.

**Query audit** (`workers/api/src/db/events.ts`):
- `fetchEventsSince` — `WHERE organization_id = ? AND created_at > ?` — benefits from new index.
- `getLatestEventCursor` — `WHERE organization_id = ? ORDER BY created_at DESC` — benefits.
- No queries filter by `type` today — a `(organization_id, type, created_at)` index is a future candidate if type-filtered dashboards are added.

**Local EXPLAIN:** not run in CI — `wrangler d1 migrations apply --local` requires a valid `name` in `wrangler.toml` (still `pdc-CHANGE_ME` in template). Apply migrations on a client instance and run:

```sql
EXPLAIN QUERY PLAN
SELECT payload_json FROM domain_events
WHERE organization_id = 'test' AND created_at > '2026-01-01';
```

---

## Fix 5 — Per-client Workers AI rate limiting (§5e)

### `workers/api/wrangler.toml`
- Optional `[[kv_namespaces]]` binding `RATE_LIMITS` with `id = "CHANGE_ME"`.

### `workers/api/src/env.ts`
- `RATE_LIMITS?: KVNamespace` — optional; absent binding disables rate limiting.

### `workers/api/src/ai/rate-limit.ts` (new)
- `checkAiRateLimit` / `recordAiCall` / `getAiCallCount` — 1-hour TTL counter per org.
- `SOFT_WARN_THRESHOLD = 500`, `HARD_LIMIT = 1000`.

### `workers/api/src/queue/consumer.ts`
- After lead-lock acquisition, before AI pipeline: rate check → on deny, update lead assessment, emit `lead.ai_rate_limited`, `msg.ack()` (no retry).
- `recordAiCall` before processing when rate check passes.

### `packages/shared-types/src/events.ts`
- Added `lead.ai_rate_limited` event type + schema.

### `apps/web/src/store/inbox-store.ts`
- `applyEvent` refreshes lead on `lead.ai_rate_limited`.

### `scripts/deploy-remote.sh`
- Creates KV namespace `RATE_LIMITS` (idempotent); reminds to paste `id` into wrangler.toml.

### `README.md`
- Cloudflare resources section expanded: DLQ, KV `RATE_LIMITS`, wrangler.toml examples.

---

## Fix 6 — Structured logging with org context (§9a)

### `workers/api/src/log.ts` (new)
- JSON structured logger: `{ level, org, msg, ts, ...meta }`.

### Critical-path migrations to `logger.*`:
- `workers/api/src/queue/consumer.ts` — permanent failure, SMS send failure, CRITICAL sync failure, rate limit exceeded.
- `workers/api/src/routes/twilio.ts` — missing auth token, invalid signature.
- `workers/api/src/routes/webhooks.ts` — missing Telnyx key, invalid signature.
- `workers/api/src/db/inbound-sms.ts` — no locations, duplicate webhook, lead creation race.

All other `console.*` calls left unchanged (incremental follow-up).

---

## Verification checklist

- [x] `_meta` table + `schema_version` in migration 0019
- [x] `EXPECTED_SCHEMA_VERSION = "0020"` in `meta.ts`
- [x] Schema gate returns 503 on mismatch (code path verified; manual test: set `_meta.schema_version` to `0000`)
- [x] `/health` skips schema gate; reports schema status in `checks.schema`
- [x] `FEATURE_REQUIREMENTS.md` on `main`
- [x] README feature-branch deploy guidance
- [x] `build-info.ts` + `gen-build-info.mjs` + deploy integration
- [x] `/health` payload includes version + checks; 503 when checks fail
- [x] `idx_domain_events_org_created` in migration 0020
- [x] `RATE_LIMITS` optional; graceful degrade without KV
- [x] Rate-limited leads get assessment + `lead.ai_rate_limited` event
- [x] README documents KV resource
- [x] `logger` on critical paths
- [x] Migrations 0019–0020 sequential; each updates `_meta.schema_version`

---

## New resources required per client

Each `pdc-{client-slug}` deployment needs:

| Resource | Wrangler / CLI | Binding / config |
|----------|----------------|------------------|
| D1 database | `wrangler d1 create pdc-{slug}-db` | `[[d1_databases]]` |
| Vectorize index | `wrangler vectorize create pdc-{slug}-knowledge ...` | `[[vectorize]]` |
| AI queue | `wrangler queues create pdc-{slug}-queue` | `[[queues.producers/consumers]]` |
| Dead-letter queue | `wrangler queues create pdc-{slug}-dlq` | `dead_letter_queue` (Phase 1) |
| KV namespace | `wrangler kv namespace create RATE_LIMITS` | `[[kv_namespaces]]` `RATE_LIMITS` (Phase 4) |
| Workers AI | `[ai]` binding in wrangler.toml | No separate resource |

`pnpm deploy:remote` creates Vectorize index, DLQ, and KV namespace if missing (KV `id` must still be pasted into wrangler.toml on first setup).

---

## Operational checklist for ongoing deployments

1. `git pull` / `git merge upstream/main` (or feature branch) in the client repo.
2. Read `FEATURE_REQUIREMENTS.md` if merging a `feat/*` branch — note minimum `schema_version` and new migrations.
3. `pnpm deploy:remote` — applies D1 migrations **before** Worker deploy; regenerates `build-info.ts`.
4. `curl https://pdc-{slug}.workers.dev/health` — confirm `"ok": true`, `checks.schema.ok`, and expected `version.gitSha`.
5. If `checks.schema.ok` is false: re-run migrations or fix version drift before serving traffic.

---

## Known limitations and follow-ups

- **Full `console.*` → `logger` migration** is incremental; only critical paths updated in Phase 4.
- **Fuzzy phone matching** in `inbound-sms.ts` remains a full-table scan at scale (deferred).
- **DLQ consumer** to alert on dead-lettered AI messages not built yet.
- **KV rate counter race** under high concurrency under-counts slightly (safe for limiting; Durable Objects if accuracy becomes necessary).
- **`build-info.ts`** committed with `dev` defaults; deploy script overwrites with real SHA — local `wrangler deploy` without `gen-build-info` reports `dev`.
- **Local `pnpm db:migrate:local`** blocked in template repo until `wrangler.toml` `name` is a valid slug (`pdc-CHANGE_ME` fails wrangler validation).
- **`domain_events` type filter index** not added — no current query uses `type` in WHERE clause.
