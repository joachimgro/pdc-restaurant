# Venue onboarding checklist (≤30 minutes)

**Status:** see git. Timed against staging on 2026-08-09: ~18 minutes with resources already created.

## Prerequisites (once per Cloudflare account)

- Wrangler logged in
- Resend domain verified for booking From-address
- Turnstile site + secret for the booking origin

## Checklist

1. **Create infra** (5 min) — D1, KV `RATE_LIMITS`, queue + DLQ, Vectorize index. Paste IDs into a venue wrangler file (copy `wrangler.staging.toml`).
2. **Flags** (1 min) — pilot posture: `ENABLE_SERVICE=true`, `ENABLE_KITCHEN=false`, `ENABLE_DEPOSITS=false`, `ENABLE_WAITLIST=false`, `ENABLE_BOOKING_SMS=false`, `ENABLE_DEMO_TOOLS=false`.
3. **Secrets** (2 min) — `RESEND_API_KEY`, `TURNSTILE_SECRET_KEY`, `ADMIN_SEED_SECRET`.
4. **Migrate + deploy** (3 min)
   ```bash
   cd workers/api
   wrangler d1 migrations apply <db-name> --remote -c wrangler.<venue>.toml
   wrangler deploy -c wrangler.<venue>.toml
   curl -sS https://<worker>/health   # expect ok:true
   ```
5. **Floor + service** (5 min)
   ```bash
   node scripts/seed-venue-demo.mjs --config=workers/api/wrangler.<venue>.toml
   ```
   Or staff console: put floor plan, service periods, turn rules, quiet hours, `no_show_grace_min`, `retentionMonths`.
6. **Invite staff** (3 min) — magic-link invite via `/auth` team invite (staff session required after first admin seed if used).
7. **Booking page live** (2 min) — point `GUEST_BOOKING_ORIGIN` / web app at the Worker; confirm `GET /book/<slug>/venue` returns 200.
8. **Smoke** (2 min) — one hold+reserve with Turnstile; confirmation email arrives.

## Done when

- `/health` green
- Staff can open the day view
- Guest can book online with Turnstile
- Confirmation email lands
