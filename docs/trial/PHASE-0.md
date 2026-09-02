# Phase 0 — Stabilise

## Done
- **0.1** Committed PWA icons/manifest/headers/layout/book Turnstile polish (`chore: commit pending PWA and book changes`). Gitignored `apps/web/.env.production`. Env names only: `NEXT_PUBLIC_API_URL`, `API_PROXY_UPSTREAM`, `NEXT_PUBLIC_TURNSTILE_SITE_KEY` (CF always-pass public test key) — **no secret rotation needed**. Left uncommitted: `docs/audit/`, `docs/plans/v2.md`.
- **0.2** `ENABLE_KITCHEN=true` in local `wrangler.dev.toml` (gitignored; both repos).
- **0.3** Added `scripts/dev-session.mjs` (SHA-256 cookie mint via wrangler D1 local).
- **0.4** Added `scripts/seed-service-day.mjs` (menu 5×6 + steaks, seated today on tbl-12, in_progress ticket).
- **0.5** `workers/api/src/routes/kitchen.test.ts` — create, bump chain, void, unknown item (4 passing).
- **0.6** `EXPECTED_GIT_SHA` in wrangler.toml; `deploy-remote.sh` stamps pin with build-info.
- **0.7** README schema/flags match wrangler + meta `0046`.
- **0.8** Live web: `GET /` → **307** `/inbox` → **200** (not a broken shell when followed). `/login` 200.

## Skipped / changed
- Template `wrangler.dev.toml` not in git (gitignored) — local edit only.
- Template full vitest: pre-existing `load-saturday.test.ts` fails on date lag (notifications OOS); kitchen tests green.

## Blocked
- None.

## Verify
```bash
cd pdc-restaurant/workers/api && pnpm exec vitest run src/routes/kitchen.test.ts
node scripts/dev-session.mjs --config=workers/api/wrangler.dev.toml
curl -sSIL https://kitchen.phiof.digital/ | head -20
```

## Assumptions
- Table id `tbl-12` from venue seed; `menu_categories.station` already exists (no Phase 1 ALTER).
- Template work on `feat/order` @ `8d9fcd5`.
