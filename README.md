# pdc-restaurant

Restaurant-only PDC instance (fork of `pdc-template`). Source of truth for features is **pdc-template**; sync into this repo to test.

| | |
|---|---|
| Web | https://kitchen.phiof.digital |
| API | https://api.kitchen.phiof.digital |
| Schema | **0043** |

## Flags (this instance)

- `ENABLE_WAITLIST=true`
- `ENABLE_KITCHEN=true`
- `ENABLE_DEPOSITS=false` (set Stripe secrets + flip to `true` when ready)

## What’s live

- Service: Today / Floor / Calendar / **Waitlist** / **Stats**
- Guests inbox + contact threads (Flag / Mute)
- Guest VIP / reliability on reservation drawer
- Review-request cron (needs `review_url` on venue settings)
- Kitchen plugin: Submit / Chef / Ready boards
- Auth + booking mail: `admin@bookings.phiof.digital`

## Deploy

```bash
pnpm deploy:remote   # API + D1 migrations
pnpm deploy:web      # OpenNext → kitchen.phiof.digital
```

Sign in: https://kitchen.phiof.digital/login (`joachim@phiof.digital` / `jack@phiof.digital`).
