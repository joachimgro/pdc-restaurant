# pdc-restaurant

Restaurant-only PDC instance (fork of `pdc-template`). Source of truth for features is **pdc-template**; sync into this repo to test.

| | |
|---|---|
| Web | https://kitchen.phiof.digital |
| API | https://api.kitchen.phiof.digital |
| Schema | **0046** (`EXPECTED_SCHEMA_VERSION`) |

## Flags (this instance — `workers/api/wrangler.toml`)

- `ENABLE_SERVICE=true`
- `ENABLE_RESERVATIONS=true`
- `ENABLE_FLOOR_PLAN=true`
- `ENABLE_AUTO_ASSIGN=true`
- `ENABLE_KITCHEN=true`
- `ENABLE_WAITLIST=false`
- `ENABLE_DEPOSITS=false` (set Stripe secrets + flip to `true` when ready)
- `ENABLE_BOOKING_SMS=true`
- `ENABLE_DEMO_TOOLS=false`

## What’s live

- Service: Today / Floor / Calendar / Stats (Waitlist UI gated off)
- Guests inbox + contact threads (Flag / Mute)
- Kitchen plugin: Order / Kitchen / Menu boards
- Auth + booking mail: `admin@bookings.phiof.digital`

## Local trial

```bash
cd workers/api && pnpm exec wrangler d1 migrations apply pdc-dev-db --local --config wrangler.dev.toml
node scripts/seed-service-day.mjs --local --config=workers/api/wrangler.dev.toml
node scripts/dev-session.mjs --config=workers/api/wrangler.dev.toml
pnpm dev:worker   # wrangler.dev.toml + ENABLE_KITCHEN
pnpm dev          # web on :3000
```

## Deploy

```bash
pnpm deploy:remote   # migrate, gen-build-info, stamp EXPECTED_GIT_SHA, wrangler deploy, /health
pnpm deploy:web      # OpenNext → kitchen.phiof.digital
```

Sign in: https://kitchen.phiof.digital/login (`joachim@phiof.digital` / invited staff).
