# pdc-restaurant

Restaurant-only PDC instance: Service console, floor plan, reservations, and the guest booking loop (`/book/[slug]`).

Same Cloudflare account as `pdc-phiof`. Separate Worker, D1, queues, and KV so the tuition demo stays untouched.

| | |
|---|---|
| Worker | `pdc-restaurant` |
| Org | `restaurant` |
| D1 | `pdc-restaurant-db` |
| Upstream | `pdc-template` (`feat/guest-loop` → `main`) |

## Quick start (local)

```bash
pnpm install
pnpm db:migrate:local
node scripts/seed-venue-demo.mjs --local
pnpm dev:worker   # :8788
pnpm dev          # :3000
```

- Staff inbox: http://localhost:3000/inbox?view=service  
- Guest book: http://localhost:3000/book/the-test-kitchen  

Sign in as `joachim@phiof.digital` (platform super admin). With Resend unset locally, magic-link verify URLs print in the Worker log.

## Deploy

```bash
pnpm deploy:remote
pnpm exec wrangler d1 migrations apply pdc-restaurant-db --remote --config workers/api/wrangler.toml
node scripts/seed-venue-demo.mjs   # remote (uses WORKER_URL / wrangler)
```

## Secrets

Cloudflare Worker secrets are write-only — they cannot be exported from `pdc-phiof`. Put the same values you use on phiof:

```bash
cd workers/api
echo -n '…' | wrangler secret put RESEND_API_KEY
echo -n '…' | wrangler secret put TELNYX_API_KEY
echo -n '…' | wrangler secret put TELNYX_FROM_NUMBER
echo -n '…' | wrangler secret put TELNYX_WEBHOOK_PUBLIC_KEY
# optional:
echo -n '…' | wrangler secret put TURNSTILE_SECRET_KEY
echo -n '…' | wrangler secret put TELNYX_MESSAGING_PROFILE_ID
```

`ENCRYPTION_KEY` is already set (same local key as phiof `.dev.vars`).

Or dump into a gitignored file and bulk-apply:

```bash
# workers/api/secrets.env  (do not commit)
RESEND_API_KEY=re_…
TELNYX_API_KEY=KEY…
TELNYX_FROM_NUMBER=+44…
TELNYX_WEBHOOK_PUBLIC_KEY=…

./scripts/put-secrets.sh
```

## Sync from template

```bash
# from pdc-template after guest-loop merges
rsync -a --exclude node_modules --exclude .git \
  --exclude 'workers/api/wrangler.toml' \
  --exclude 'apps/web/.env.local' \
  --exclude '.env' \
  --exclude 'workers/api/.dev.vars' \
  ./ ../pdc-restaurant/
```
