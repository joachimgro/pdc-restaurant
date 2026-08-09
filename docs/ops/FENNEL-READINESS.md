# Fennel deployment readiness

**Live fork:** `pdc-restaurant` · Worker `pdc-restaurant` · D1 `pdc-restaurant-db`  
**API:** `https://api.kitchen.phiof.digital` · **Web:** `https://kitchen.phiof.digital`  
**Slug:** `the-test-kitchen`

Stamp model: see template `docs/ops/DEPLOYMENT-MODEL.md`. This fork is already the kitchen stamp; apply migrations + redeploy Worker after each gate.

## Secrets checklist (names only — tick when set)

- [ ] `RESEND_API_KEY`
- [ ] `RESEND_WEBHOOK_SECRET` (recommended)
- [ ] `TELNYX_API_KEY`
- [ ] `TELNYX_FROM_NUMBER` (or `TELNYX_MESSAGING_PROFILE_ID`)
- [ ] `TELNYX_WEBHOOK_PUBLIC_KEY`
- [ ] `ENCRYPTION_KEY`
- [ ] `TURNSTILE_SECRET_KEY`
- [ ] `ADMIN_SEED_SECRET` (erase/export / admin scripts)
- [ ] `STRIPE_SECRET_KEY` — only if deposits ever enabled (currently off)
- [ ] `STRIPE_WEBHOOK_SECRET` — only if deposits enabled

## Vars / flags checklist (names)

- [ ] `ORGANIZATION_ID`
- [ ] `CORS_ORIGIN`
- [ ] `AUTH_FROM_EMAIL` / `BOOKING_FROM_EMAIL`
- [ ] `AUTH_WEB_ORIGIN` / `GUEST_BOOKING_ORIGIN`
- [ ] `ENABLE_SERVICE=true`
- [ ] `ENABLE_RESERVATIONS=true`
- [ ] `ENABLE_WAITLIST=false` (fail-closed for go-live)
- [ ] `ENABLE_DEPOSITS=false`
- [ ] `ENABLE_BOOKING_SMS=true` (or false if email-only weekend)
- [ ] `ENABLE_DEMO_TOOLS=false` for real service
- [ ] `ENABLE_FLOOR_PLAN` / `ENABLE_AUTO_ASSIGN` / `ENABLE_KITCHEN` as intended
- [ ] Optional alerts: `NOTIFICATION_BACKLOG_ALERT_MINUTES`, `NOTIFICATION_FAILED_24H_ALERT`, `NOTIFICATION_SKIPPED_24H_ALERT`, `REMINDER_STALE_MINUTES`

## Fail-closed

- Missing required secrets / misconfigured From domain → `/health` **503** via `config_gate`.
- Schema behind Worker → `/health` schema check fails; non-health routes **503**.
- Missing Telnyx webhook public key → inbound webhook **500** (rejects STOP handling until set).
- Waitlist flag off → routes **404**, console tab hidden.

## External uptime monitor

- **URL:** `https://api.kitchen.phiof.digital/health`
- **Healthy:** HTTP **200**, JSON `"ok": true`
- **Unhealthy:** HTTP **503** (or non-200) — treat as page. Prefer alert on body `ok !== true` if the monitor supports JSON.

## Saturday rollback (&lt;5 minutes)

1. **Stop the bleed:** set `ENABLE_BOOKING_SMS=false` (redeploy vars) if SMS is the problem; guests still get email.
2. **Worker rollback:** Cloudflare dashboard → Workers → `pdc-restaurant` → Deployments → **Rollback** to last known-good SHA (note SHA before go-live).
3. **Do not** roll D1 migrations back mid-service. Schema is forward-only; if a migration is half-applied, keep Worker on a build that matches `EXPECTED_SCHEMA_VERSION`.
4. **If booking UI is broken:** point DNS/web briefly to a static “call the restaurant” page, or disable public book by setting a Turnstile secret mismatch only as last resort (prefer Worker rollback).
5. **Notify venue:** phone bookings only until health is green again.
6. After service: inspect `/health` `notificationQueue.skippedByReason` + failed_24h; fix forward, then redeploy.

## Onboarding against Fennel floor

Run venue onboarding (rooms, tables, periods, turn/pacing) from the service console / seed scripts. Record elapsed time and any manual SQL/UI fixes in the go-live report.
