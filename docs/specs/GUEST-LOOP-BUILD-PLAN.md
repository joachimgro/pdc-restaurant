# Guest Loop Build Plan — Phases 5 + 6

**Branch:** `feat/guest-loop` (off `main`, after Phase 4 console merge)
**Target schema:** `0036` → `0039` (notifications + guest tokens in this deliverable)
**Status:** plan ready — implement only after Joachim approves
**Closed-loop demo:** guest books → confirmation email/SMS → reminder scheduled → manager sees it live on the floor

This document outworks the combined Phase 5+6 gate in `SERVICE-MODULE-BUILD-SPEC.md`. Where this plan and the master spec disagree, **this plan wins for guest-loop scope**; update the master spec in the same PR that lands the code.

---

## 0. Decisions locked before coding

| # | Decision | Choice | Why |
|---|---|---|---|
| D1 | SMS outbound provider | **Twilio first**, with a thin `sendBookingSms(env, to, body)` facade | Template has `twilio/send.ts` only; `telnyx/send.ts` does not exist. Facade lets Telnyx land later without rewriting callers. |
| D2 | Migration numbering vs waitlist FK | Ship **`0039_notifications.sql` without FKs to `waitlist_entries`** | Waitlist table is Phase 7 (0037). FKing 0039 → a missing table breaks every deploy. Columns `waitlist_entry_id` stay nullable TEXT; Phase 7 migration adds the FK or leaves soft refs. |
| D3 | Deposit step (UI step 5) | **Skip entirely in guest-loop** | `ENABLE_DEPOSITS=false`. Flow is party → date → time → details → confirmed. Stripe is Phase 8. |
| D4 | Waitlist exits (§8 anti-mistake) | **Soft exits only** — phone CTA + “we’ll call you” copy; no `waitlist_entries` writes | Full waitlist is Phase 7. Dead-end rule still holds: never leave the guest with only an error. |
| D5 | Availability channel | Every `/book/*` availability/days call passes **`channel=online`** | Server already rejects missing channel (`CHANNEL_REQUIRED`). |
| D6 | Guest identity | `resolveGuest` lookup only — **never create leads**; create/link contacts when CRM tables exist (probe) | Matches `guests.ts` + CLAUDE.md. |
| D7 | Manage URL shape | Ship **`/manage/[token]`** as in §8 (not nested under `/book/`) | Simpler share links; Worker path remains `/book/manage/:token` for allowlist grouping. |
| D8 | Cron stubs | Dispatcher includes no-op stubs for waitlist/payment sweepers | Keeps §11 order stable; stubs log and return until Phase 7/8. |
| D9 | Turnstile in local/dev | Bypass when `TURNSTILE_SECRET_KEY` unset **and** `ENABLE_DEMO_TOOLS=true` | Real verify in production. Never bypass when secret is set. |
| D10 | Schema bump | `EXPECTED_SCHEMA_VERSION = "0039"` in the same commit as migration 0039 | Skip 0037/0038 numbers for now; they remain reserved for waitlist/payments. Document the gap in migration README. |

---

## 1. Closed-loop acceptance (the only gate)

All four must pass before merge to `main`:

1. **Anti-mistake list (§8)** verified on a real phone: book, change, cancel — no dead ends, back safe, forgiving phone, no double-submit.
2. **Confirmation &lt; 30s** after reserve (email and/or SMS depending on what contact fields were given).
3. **Reminder rows** exist as `notifications` with `status=scheduled` and correct `scheduled_for`; cancel flips them to `cancelled`.
4. **Live console:** new booking appears on Today/Floor without refresh (existing `reservation.created` SSE).

Plus: `pnpm test` green in `workers/api`; local migrate to 0039; seed venue has a `booking_slug`.

---

## 2. Architecture snapshot

```
Guest phone                    Worker                         Staff iPad
───────────                    ──────                         ──────────
/book/[slug]  ──public──►  /book/:slug/*  ──► holds + reservations
                           resolveGuest, assignTables(online)
                           mint guest_access_token
                           schedule notifications
                           emit reservation.created  ──SSE──►  Console

                           cron */5
                             sweepExpiredHolds
                             dispatchDueNotifications → Resend / Twilio
```

**Public allowlist addition** (in `workers/api/src/index.ts`):
- All `/book/*` paths are public (Turnstile + rate limits + guest tokens protect writes).
- Staff `/service/*` unchanged (session required).

---

## 3. Work packages (implement in this order)

### WP0 — Branch + scaffolding
- Create `feat/guest-loop` from current `main`.
- Add empty modules listed in §11 file map so imports resolve early.
- Env additions in `env.ts` + `wrangler.toml` comments:
  - `TURNSTILE_SECRET_KEY`, `GUEST_BOOKING_ORIGIN` (or reuse `AUTH_WEB_ORIGIN`)
  - Web: `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `NEXT_PUBLIC_API_URL` (already)
- Seed: ensure `venue_settings.booking_slug` set (e.g. `the-test-kitchen` already in seed).

**Commit:** `chore(guest-loop): branch scaffolding and env stubs`

---

### WP1 — Migration `0039_notifications.sql`

```sql
-- notifications + guest_access_tokens
-- waitlist_entry_id is TEXT nullable with NO FK until Phase 7
-- schema_version → 0039
```

Tables as in master spec §4, with these deltas:
- Drop `REFERENCES waitlist_entries(...)` on both tables.
- `notifications.status`: `scheduled` | `sending` | `sent` | `failed` | `cancelled`
- `notifications.channel`: `email` | `sms`
- `guest_access_tokens.scope`: `manage_reservation` (waitlist scopes later)

Bump `EXPECTED_SCHEMA_VERSION` to `"0039"` same commit.

**Tests:** migration applies on empty + on 0036 DB; `_meta` = 0039.

**Commit:** `feat(guest-loop): migration 0039 notifications and guest tokens`

---

### WP2 — Email + SMS primitives

| File | Role |
|---|---|
| `workers/api/src/email/send.ts` | Generic Resend POST; skip+warn if keys missing (match magic-link behaviour) |
| `workers/api/src/email/layout.ts` | Venue-branded shell from `brand_json` |
| `workers/api/src/email/templates/reservation-confirmed.ts` | `{ subject, html, text }` |
| `workers/api/src/email/templates/reservation-reminder.ts` | |
| `workers/api/src/email/templates/reservation-changed.ts` | |
| `workers/api/src/email/templates/reservation-cancelled.ts` | |
| `workers/api/src/notifications/sms.ts` | `sendBookingSms` → Twilio facade |
| `workers/api/src/notifications/schedule.ts` | Insert scheduled rows with idempotency keys |
| `workers/api/src/notifications/dispatch.ts` | Claim due rows, send, mark sent/failed |
| `workers/api/src/lib/turnstile.ts` | `verifyTurnstile(env, token, ip)` |
| `workers/api/src/lib/booking-rate-limit.ts` | KV counters per IP / venue |

Refactor `magic-link.ts` to call `email/send.ts` **without** changing staff auth behaviour.

**Scheduling rules at reserve time:**
| Template | When `scheduled_for` |
|---|---|
| `reservation_confirmed` email | `now` (immediate) |
| `reservation_confirmed` SMS | `now` if phone present; else skip |
| `reservation_reminder` email | `starts_at_utc − 24h` if that is still in the future |
| `reservation_reminder_sms` | `starts_at_utc − 3h` if future; else skip |

SMS quiet hours (21:00–08:00 venue local): if immediate SMS would land in quiet hours, set `scheduled_for` to next 08:00 venue local (confirmations are transactional — **exception:** confirmation SMS may send immediately anyway for the demo gate; reminder SMS must respect quiet hours). **Locked choice:** confirmation SMS sends immediately; reminder SMS defers to 08:00 if in quiet window.

**Commit:** `feat(guest-loop): email/SMS send, templates, schedule/dispatch`

---

### WP3 — Cron dispatcher

1. `wrangler.toml`:
   ```toml
   [triggers]
   crons = ["*/5 * * * *"]
   ```
2. Export `scheduled` from `workers/api/src/index.ts` alongside `fetch` / `queue`.
3. `workers/api/src/cron/dispatcher.ts` runs in order, try/catch each step:
   1. `sweepExpiredHolds`
   2. `expirePendingPayments` — **no-op stub** (log)
   3. `dispatchDueNotifications` (limit 50)
   4. `expireWaitlistNotifications` — **no-op stub**
   5. `markNoShows` — flag only (optional light impl: insert staff-visible note / domain event `reservation.no_show_flag`; do **not** set status `no_show`)
4. Local test: invoke dispatcher functions directly in vitest (no need to wait for cron).

**Commit:** `feat(guest-loop): cron dispatcher and hold sweep`

---

### WP4 — Guest tokens

`workers/api/src/plugins/service/guest-tokens.ts`:
- `mintGuestToken(env, { reservationId, scope, ttlDays })` → raw token once; store `hashToken(raw)`
- `resolveGuestToken(env, raw)` → reservation or 401/410
- TTL default 90 days or until `service_date` end + 1 day, whichever earlier
- Revoke on cancel

Manage links: `{GUEST_BOOKING_ORIGIN}/manage/{rawToken}`

**Commit:** `feat(guest-loop): guest access tokens`

---

### WP5 — Public book API (`workers/api/src/routes/book.ts`)

Allowlist + dispatch in `index.ts` for:

| Method | Path | Behaviour |
|---|---|---|
| GET | `/book/:slug/venue` | Brand, address, phone, party bounds, periods summary; 404 generic if slug unknown |
| GET | `/book/:slug/days` | `from,to,party` → fullness map via online availability aggregates |
| GET | `/book/:slug/availability` | `date,party` → **available-only** slots, `channel=online` |
| POST | `/book/:slug/hold` | Turnstile + rate limit → `createHold` online assign → `{ holdToken, expiresAt, tables? }` |
| POST | `/book/:slug/reserve` | Turnstile + Idempotency-Key + hold consume → reservation `source=online` → mint manage token → schedule notifs → domain event → 201 |
| GET | `/book/manage/:token` | Summary + permitted actions |
| POST | `/book/manage/:token/cancel` | Cancel + cancel scheduled notifs + emit event |
| POST | `/book/manage/:token/modify` | Requires new hold token; reschedule notifs |

**Out of scope for this WP:** `/book/:slug/waitlist`, `/book/waitlist/*`.

**Zod:** add book request/response schemas to `packages/shared-types/src/service.ts` (or `book.ts` exported from index).

**Reuse:**
- `findLocationByBookingSlug`
- `loadAvailability(..., channel: "online")`
- `createHold` / `consumeHold` / `holdTableIds`
- `resolveGuest`
- `generateReference`
- Staff `handleCreateReservation` logic extracted into shared `createReservationFromHold(...)` used by staff + guest paths — **prefer extract over copy**.

**Idempotency:** store key on reservation (new column `idempotency_key TEXT UNIQUE` on `reservations` via 0039, or separate table). Prefer column on `reservations` in 0039.

**Rate limits (KV):** 10 avail/min/IP, 5 holds/min/IP, 3 reserves/min/IP, 20 writes/hour/IP, 50 reserves/hour/venue.

**Commit:** `feat(guest-loop): public /book API hold reserve manage`

---

### WP6 — Guest web UI

```
apps/web/src/app/
├── book/[slug]/page.tsx
├── book/[slug]/book.css          # light theme, mobile-first; do NOT inherit Soft Bubble dark
├── book/[slug]/_components/     # step screens, shared chrome
└── manage/[token]/page.tsx
```

**Flow state:** URL query owns step + party + date + time so back is safe (`?step=time&party=2&date=2026-08-12` …).

**Steps implemented:** 1 party → 2 date → 3 time → 4 details → 6 confirmed. (No deposit.)

**Hard UI rules from §8:**
- One question per screen; thin progress bar
- Primary CTA ≥ 56px, full width, pinned bottom
- Hold: enter details → POST hold; countdown only in last 120s
- Turnstile widget on hold + reserve (invisible/managed mode OK)
- Soft waitlist exit: venue phone + short copy when full / party &gt; max
- Sentence case, venue voice, no “Submit” / “Oops”

**API client:** `apps/web/src/lib/api/book.ts` — no staff cookies; public fetch.

**Commit:** `feat(guest-loop): mobile booking and manage pages`

---

### WP7 — Wire confirmations into reserve + cancel/modify

On successful reserve:
1. Insert confirmation email (+ SMS if phone) as due-now rows
2. Insert reminder rows when in window
3. Optionally invoke `dispatchDueNotifications` once inline for the due-now set so confirmation does not wait for cron (meets &lt;30s gate even if cron is 5 min)

On cancel / modify: cancel outstanding scheduled rows; modify reschedules reminders; send `reservation_cancelled` / `reservation_changed`.

**Commit:** `feat(guest-loop): schedule and send booking notifications`

---

### WP8 — Tests + seed + docs

**Worker tests (minimum):**
- `book.test.ts` — venue 404 shape, hold conflict → 409 + alternatives, reserve idempotency, manage cancel
- `notifications.test.ts` — idempotency key unique, reminder skip if &lt;24h, cancel clears scheduled, quiet-hours deferral for reminder SMS
- `turnstile.test.ts` — reject bad token when secret set; allow bypass only demo+unset
- Cron unit: sweepExpiredHolds frees inventory

**Seed:**
- Ensure slug + brand_json for Test Kitchen
- Optional: one future reservation with scheduled reminder for console demos

**Docs:**
- Point master spec Phase 5+6 at this plan
- Note migration number gap 0037/0038 reserved
- Client-setup: Turnstile keys, `GUEST_BOOKING_ORIGIN`, Twilio/Resend already required

**Commit:** `test(guest-loop): book API, notifications, turnstile`  
**Commit:** `docs(guest-loop): wire plan into master spec`

---

## 4. Explicitly out of scope (do not build in this branch)

- Stripe / deposit UI / `pending_payment` real flow (Phase 8)
- Waitlist tables, promote-on-cancel, `/waitlist/[token]` (Phase 7)
- Telnyx outbound (facade only)
- Guest profiles / 0040
- AI pipeline changes / SMS → staff task (Phase 8)
- Settings UI for notification templates
- CSP / Vercel multi-subdomain hosting automation (document manual slug→path for demo: `/book/the-test-kitchen`)

---

## 5. File map (new)

```
workers/api/
├── migrations/0039_notifications.sql
├── src/
│   ├── routes/book.ts
│   ├── routes/book.test.ts
│   ├── cron/dispatcher.ts
│   ├── email/{send,layout}.ts
│   ├── email/templates/reservation-*.ts
│   ├── notifications/{schedule,dispatch,sms}.ts
│   ├── notifications/notifications.test.ts
│   ├── lib/{turnstile,booking-rate-limit}.ts
│   └── plugins/service/guest-tokens.ts
apps/web/src/
├── app/book/[slug]/{page.tsx,book.css,_components/*}
├── app/manage/[token]/page.tsx
└── lib/api/book.ts
packages/shared-types/src/book.ts   # or extend service.ts
docs/specs/GUEST-LOOP-BUILD-PLAN.md  # this file
```

---

## 6. Suggested implementation sequence for Claude

1. WP0 → WP1 → `pnpm test` + migrate local  
2. WP2 → WP3 → WP4 (backend messaging + tokens)  
3. WP5 (book API) — hardest correctness; Fable-class attention on hold/idempotency  
4. WP7 (wire notifs into reserve) before UI so curl can prove the closed loop  
5. WP6 (UI) — Opus-class  
6. WP8 gate checklist on phone + iPad console watching SSE  

Stop and report after WP5 if hold/reserve concurrency or Turnstile design needs a human call.

---

## 7. Demo script (gate day)

1. Seed venue; open staff console on desktop/iPad (`/inbox?view=service`).  
2. On phone Safari: `/book/the-test-kitchen` → book a table for tomorrow.  
3. Confirm screen shows reference + manage link.  
4. Check email/SMS (or Worker logs if Resend unset in demo).  
5. Console Today/Floor updates without refresh.  
6. Open manage link → cancel → confirmation email; reminder rows cancelled in D1.  
7. Re-book → change time → changed email; new reminders scheduled.

---

## 8. Open risks (monitor, don’t block start)

| Risk | Mitigation |
|---|---|
| Soft waitlist exits feel unfinished to GMs | Copy must say “call us” clearly; Phase 7 follows immediately after gate |
| Confirmation waits on cron | Inline dispatch of due-now rows at reserve (WP7) |
| Twilio vs Telnyx brand | Facade; document in client-setup |
| Migration number gap confuses forks | README note + this plan §0 D10 |
| Turnstile + localhost | Demo bypass rule D9 |

---

**Approval checkpoint:** Joachim signs off this plan → create `feat/guest-loop` and start WP0. Do not begin implementation before that sign-off (`CLAUDE.md`).
