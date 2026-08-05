# Guest Loop Build Plan — Phases 5 + 6

**Branch:** `feat/guest-loop` off **`main`** (Phase 4 console already merged — see §0 D0)
**Target schema:** `0036` → **`0037`** (notifications + guest tokens; next sequential number)
**Status:** implemented on `feat/guest-loop` — gate pending phone/iPad demo
**Closed-loop demo:** guest books → confirmation email/SMS → reminder scheduled → manager sees it live on the floor

This document outworks the combined Phase 5+6 gate in `SERVICE-MODULE-BUILD-SPEC.md`. Where this plan and the master spec disagree, **this plan wins for guest-loop scope**; update the master spec in the same PR that lands the code.

---

## 0. Decisions locked before coding

| # | Decision | Choice | Why |
|---|---|---|---|
| D0 | Branch base | **`feat/guest-loop` from current `main`** | Console (`7b2d99b` and follow-ons) is already on `main`. Stacking on `feat/service-console` would force ordered merges and double conflict resolution for no gain. Do **not** branch until verifying `ServiceWorkspace` / console paths exist on the tip you cut from. |
| D1 | SMS outbound provider | **Telnyx** via `sendBookingSms` → `sendTelnyxSms` | Master spec and Joachim’s stack already chose Telnyx on cost. Inbound + `TELNYX_*` env exist in template; outbound `telnyx/send.ts` lives in `pdc-phiof` and is **ported into template** in WP2. Twilio stays for inbound/legacy lead paths only — **not** used for booking SMS. |
| D2 | Migration number | Ship **`0037_notifications.sql`** next | Migrations are append-only and sequential. Do not reserve 0037/0038 for later phases. Waitlist becomes **0038** when it lands; payments **0039**; guest profiles stay **0040**. |
| D3 | Waitlist FK | **No FK** to `waitlist_entries` in 0037 | That table does not exist yet. Columns `waitlist_entry_id` stay nullable TEXT. Comment in the migration why. Phase 7 (0038) may add an FK or keep soft refs — decide then. |
| D4 | Deposit step (UI step 5) | **Skip entirely in guest-loop** | `ENABLE_DEPOSITS=false`. Flow: party → date → time → details → confirmed. Stripe is Phase 8. |
| D5 | Waitlist exits (§8 anti-mistake) | **Soft exits only** — phone CTA + “we’ll call you”; no `waitlist_entries` writes | Full waitlist is Phase 7. Dead-end rule still holds. |
| D6 | Availability channel | Every `/book/*` availability/days call passes **`channel=online`** | Server rejects missing channel (`CHANNEL_REQUIRED`). |
| D7 | Guest identity | `resolveGuest` lookup only — **never create leads**; create/link contacts when CRM tables exist (probe) | Matches `guests.ts` + CLAUDE.md. |
| D8 | Manage URL shape | Ship **`/manage/[token]`** as in §8 | Worker path remains `/book/manage/:token` for allowlist grouping. |
| D9 | Cron stubs | Dispatcher includes no-op stubs for waitlist/payment sweepers | Keeps §11 order stable; stubs log and return until Phase 7/8. |
| D10 | Turnstile in local/dev | Bypass when `TURNSTILE_SECRET_KEY` unset **and** `ENABLE_DEMO_TOOLS=true` | Real verify in production. Never bypass when secret is set. |
| D11 | Schema bump | `EXPECTED_SCHEMA_VERSION = "0037"` in the same commit as migration 0037 | |

---

## 1. Closed-loop acceptance (the only gate)

All must pass before merge to `main`:

1. **Anti-mistake list (§8)** verified on a real phone: book, change, cancel — no dead ends, back safe, forgiving phone, no double-submit.
2. **Confirmation &lt; 30s** after reserve (email and/or SMS depending on contact fields).
3. **Reminder rows** exist as `notifications` with `status=scheduled` and correct `scheduled_for` (UTC); cancel flips them to `cancelled` **and** a subsequent dispatcher tick must not send them.
4. **Cancelled booking never reminds:** cancel a booking that has a due-now reminder queued/claimed — assert no SMS/email fires for that reservation after cancel (send-time status check).
5. **Live console:** new booking appears on Today/Floor without refresh (existing `reservation.created` SSE).

Plus: `pnpm test` green in `workers/api`; local migrate to 0037; seed venue has a `booking_slug`.

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
                             dispatchDueNotifications
                               claim → status check → Telnyx/Resend
```

**Public allowlist:** all `/book/*` paths public (Turnstile + rate limits + guest tokens protect writes). Staff `/service/*` unchanged.

---

## 3. Work packages (implement in this order)

### WP0 — Branch + scaffolding
- Create `feat/guest-loop` from **current `main`** (confirm console present).
- Env stubs: `TURNSTILE_SECRET_KEY`, `GUEST_BOOKING_ORIGIN` (or reuse `AUTH_WEB_ORIGIN`); ensure `TELNYX_API_KEY` / `TELNYX_FROM_NUMBER` / `TELNYX_MESSAGING_PROFILE_ID` documented for booking SMS.
- Web: `NEXT_PUBLIC_TURNSTILE_SITE_KEY`.
- Seed: `venue_settings.booking_slug` (e.g. `the-test-kitchen`).

**Commit:** `chore(guest-loop): branch scaffolding and env stubs`

---

### WP1 — Migration `0037_notifications.sql`

```sql
-- 0037_notifications.sql
-- Next sequential after 0036. Waitlist/payments are NOT reserved numbers;
-- they will be 0038+ when those phases land.
--
-- waitlist_entry_id is nullable TEXT with NO FOREIGN KEY: waitlist_entries
-- does not exist until Phase 7. Soft reference only; do not add FK here.
```

Tables as in master spec §4 notifications section (renumbered), with:
- Drop `REFERENCES waitlist_entries(...)` on `notifications` and `guest_access_tokens`.
- `notifications.status`: `scheduled` | `sending` | `sent` | `failed` | `cancelled` | `skipped`
- `notifications.channel`: `email` | `sms`
- `guest_access_tokens.scope`: `manage_reservation` (waitlist scopes later)
- Optional on `reservations`: `idempotency_key TEXT UNIQUE` for reserve retries (same migration ALTER or companion statements)

Bump `EXPECTED_SCHEMA_VERSION` to `"0037"` same commit.

**Tests:** applies on empty + on 0036 DB; `_meta` = 0037.

**Commit:** `feat(guest-loop): migration 0037 notifications and guest tokens`

---

### WP2 — Email + Telnyx SMS primitives

| File | Role |
|---|---|
| `workers/api/src/telnyx/send.ts` | **Port from `pdc-phiof`** — `sendTelnyxSms` / `telnyxConfigured` |
| `workers/api/src/email/send.ts` | Generic Resend POST; skip+warn if keys missing |
| `workers/api/src/email/layout.ts` | Venue-branded shell from `brand_json` |
| `workers/api/src/email/templates/reservation-*.ts` | confirmed / reminder / changed / cancelled |
| `workers/api/src/notifications/sms.ts` | `sendBookingSms` → **Telnyx only** |
| `workers/api/src/notifications/schedule.ts` | Insert scheduled rows; deterministic idempotency keys |
| `workers/api/src/notifications/dispatch.ts` | Claim → send-time guards → send → mark (see §3a) |
| `workers/api/src/lib/turnstile.ts` | `verifyTurnstile` |
| `workers/api/src/lib/booking-rate-limit.ts` | KV counters |
| `workers/api/src/lib/venue-time.ts` | Venue-local ↔ UTC helpers for quiet hours + `scheduled_for` (BST/GMT) |

Refactor `magic-link.ts` to call `email/send.ts` without changing staff auth behaviour.

**Scheduling rules at reserve time:**

| Template | When `scheduled_for` |
|---|---|
| `reservation_confirmed` email | `now` (immediate) |
| `reservation_confirmed` SMS | `now` if phone present; else skip |
| `reservation_reminder` email | `starts_at_utc − 24h` if still in the future |
| `reservation_reminder_sms` | `starts_at_utc − 3h` if future; else skip |

`scheduled_for` is always stored as **UTC ISO**. Compute from `service_date` + `start_time` + venue IANA timezone (already on venue settings); never “guess” from browser local. Quiet hours (21:00–08:00 **venue local**): confirmation SMS may send immediately (transactional / demo gate); **reminder SMS** defers to next 08:00 venue local if the computed send falls in the quiet window.

**Commit:** `feat(guest-loop): email/Telnyx send, templates, schedule/dispatch`

---

### WP3 — Cron dispatcher (+ correctness — see §3a)

1. `wrangler.toml`:
   ```toml
   [triggers]
   crons = ["*/5 * * * *"]
   ```
2. Export `scheduled` from `workers/api/src/index.ts` alongside `fetch` / `queue`.
3. `workers/api/src/cron/dispatcher.ts` runs in order, try/catch each step:
   1. `sweepExpiredHolds`
   2. `expirePendingPayments` — **no-op stub**
   3. `dispatchDueNotifications` (limit 50) — **full claim + send-time checks**
   4. `expireWaitlistNotifications` — **no-op stub**
   5. `markNoShows` — flag only (optional light: domain event; do **not** auto-set `no_show`)
4. Vitest invokes dispatcher functions directly (no waiting on cron).

**Commit:** `feat(guest-loop): cron dispatcher and hold sweep`

---

### §3a — Dispatcher correctness (non-negotiable)

This is as load-bearing as the public hold/reserve path. Failures here are what a pilot GM notices: a cancelled guest getting “see you tomorrow.”

#### Overlapping cron / double-send

Two ticks (or a stuck tick + the next) must not both send the same row.

1. **Claim atomically** before any provider call:
   ```sql
   UPDATE notifications
   SET status = 'sending', attempts = attempts + 1, updated_at = datetime('now')
   WHERE id = ? AND status = 'scheduled' AND scheduled_for <= ?
   ```
   If `changes === 0`, another worker already claimed or the row left `scheduled` — **skip**.
2. After send success → `sent` + `sent_at` + `provider_message_id`.
3. After send failure → `failed` or back to `scheduled` with backoff only if attempts &lt; N; never leave rows stuck in `sending` forever (recover: `sending` older than X minutes → `scheduled` or `failed` at start of tick).
4. **Idempotency key** remains `UNIQUE` and deterministic: `{reservation_id}:{template}:{channel}:{scheduled_for}`. Insert-at-schedule-time is the duplicate-*row* defence; claim is the duplicate-*send* defence. Both are required.

#### Cancelled booking must not remind (send-time check)

Cancelling updates notification rows to `cancelled` — that is necessary but **not sufficient**. A row may already be `sending`, or a race may schedule after a soft cancel path.

**Before every provider call**, re-read the linked reservation (and waitlist entry when present):

| Linked entity | Send if | Else |
|---|---|---|
| Reservation | status ∈ active set for that template (`confirmed`, `seated`, … — **not** `cancelled`, `no_show`, `expired`) | Mark notification `skipped` with `error_text` reason; **do not send** |
| Missing reservation_id | Allow only templates that are reservation-less (none in this phase) | `skipped` |

Confirmations scheduled as due-now are still subject to this check (cancel-during-dispatch race).

#### Timezone / BST

- Store and compare `scheduled_for` in UTC.
- Derive reminder times from venue timezone with an explicit IANA zone (e.g. `Europe/London`) so BST↔GMT transitions do not shift local dinner times.
- Quiet-hours deferral uses venue-local clock, then converts back to UTC for `scheduled_for`.
- Tests: a booking whose local start is the day after the October clock change still gets T−3h SMS at the correct UTC instant.

#### Required tests (WP8, but design for them here)

- Two concurrent `dispatchDueNotifications` calls → one send, one claim miss.
- Cancel reservation with due reminder → dispatcher tick sends **zero** messages for that id.
- Reminder row left in `sending` (simulated crash) → recovered and either sent once or failed cleanly — never double.
- Quiet-hours reminder SMS deferred past 08:00 venue local.
- BST boundary on `scheduled_for`.

---

### WP4 — Guest tokens

`workers/api/src/plugins/service/guest-tokens.ts`:
- `mintGuestToken` → raw once; store `hashToken(raw)`
- `resolveGuestToken` → reservation or 401/410
- TTL: 90 days or `service_date` end + 1 day, whichever earlier
- Revoke on cancel

Manage links: `{GUEST_BOOKING_ORIGIN}/manage/{rawToken}`

**Commit:** `feat(guest-loop): guest access tokens`

---

### WP5 — Public book API (`workers/api/src/routes/book.ts`)

| Method | Path | Behaviour |
|---|---|---|
| GET | `/book/:slug/venue` | Brand, address, phone, party bounds, periods; 404 generic if unknown |
| GET | `/book/:slug/days` | `from,to,party` → fullness via online aggregates |
| GET | `/book/:slug/availability` | `date,party` → available-only slots, `channel=online` |
| POST | `/book/:slug/hold` | Turnstile + rate limit → `createHold` online |
| POST | `/book/:slug/reserve` | Turnstile + Idempotency-Key + hold consume → `source=online` → mint token → schedule notifs → event → 201 |
| GET | `/book/manage/:token` | Summary + actions |
| POST | `/book/manage/:token/cancel` | Cancel + cancel scheduled notifs + emit |
| POST | `/book/manage/:token/modify` | New hold; reschedule notifs |

**Out of scope:** waitlist routes.

**Reuse:** `findLocationByBookingSlug`, `loadAvailability(..., "online")`, holds, `resolveGuest`, `generateReference`. Prefer extracting `createReservationFromHold` shared with staff create.

**Rate limits (KV):** 10 avail/min/IP, 5 holds/min/IP, 3 reserves/min/IP, 20 writes/hour/IP, 50 reserves/hour/venue.

**Commit:** `feat(guest-loop): public /book API hold reserve manage`

---

### WP6 — Guest web UI

```
apps/web/src/app/
├── book/[slug]/page.tsx
├── book/[slug]/book.css
├── book/[slug]/_components/
└── manage/[token]/page.tsx
```

URL query owns step + party + date + time. Steps: party → date → time → details → confirmed (no deposit). Soft waitlist exit: venue phone. Light theme, mobile-first; do not inherit Soft Bubble dark.

**Commit:** `feat(guest-loop): mobile booking and manage pages`

---

### WP7 — Wire confirmations into reserve + cancel/modify

On reserve: insert confirmation (+ SMS) due-now; insert reminders when in window; **inline `dispatchDueNotifications` for due-now** so confirmation does not wait for cron (&lt;30s gate).

On cancel/modify: set outstanding `scheduled` (and recoverable `sending` if safe) → `cancelled`; modify reschedules; send changed/cancelled templates.

**Commit:** `feat(guest-loop): schedule and send booking notifications`

---

### WP8 — Tests + seed + docs

**Minimum worker tests:**
- `book.test.ts` — venue 404, hold 409, reserve idempotency, manage cancel
- `notifications.test.ts` — unique idempotency key, reminder skip if &lt;24h, cancel clears scheduled, **send-time skip on cancelled reservation**, **concurrent claim**, quiet-hours, BST edge
- `turnstile.test.ts` — reject bad token when secret set; demo bypass only when allowed
- Cron: sweepExpiredHolds frees inventory

**Docs:** master spec migration order + Telnyx; client-setup Telnyx + Turnstile + Resend.

**Commit:** `test(guest-loop): book API, notifications, dispatcher`  
**Commit:** `docs(guest-loop): wire plan into master spec`

---

## 4. Explicitly out of scope

- Stripe / deposit UI / real `pending_payment` (Phase 8)
- Waitlist tables and promote-on-cancel (Phase 7 → migration **0038**)
- Twilio for booking outbound
- Guest profiles / 0040
- AI pipeline / SMS → staff task (Phase 8)
- Settings UI for notification templates
- CSP / multi-subdomain hosting automation (demo: `/book/the-test-kitchen`)

---

## 5. File map (new)

```
workers/api/
├── migrations/0037_notifications.sql
├── src/
│   ├── routes/book.ts
│   ├── routes/book.test.ts
│   ├── cron/dispatcher.ts
│   ├── telnyx/send.ts                 # port from pdc-phiof
│   ├── email/{send,layout}.ts
│   ├── email/templates/reservation-*.ts
│   ├── notifications/{schedule,dispatch,sms}.ts
│   ├── notifications/notifications.test.ts
│   ├── lib/{turnstile,booking-rate-limit,venue-time}.ts
│   └── plugins/service/guest-tokens.ts
apps/web/src/
├── app/book/[slug]/{page.tsx,book.css,_components/*}
├── app/manage/[token]/page.tsx
└── lib/api/book.ts
packages/shared-types/src/book.ts
docs/specs/GUEST-LOOP-BUILD-PLAN.md
```

---

## 6. Suggested implementation sequence

1. WP0 → WP1 → migrate + `pnpm test`
2. WP2 (incl. Telnyx port) → WP3 with §3a locked in → WP4
3. WP5 book API — hold/idempotency attention
4. WP7 wire notifs before UI so curl proves the loop
5. WP6 UI
6. WP8 gate on phone + iPad console (SSE)

Stop after WP5 if hold/reserve concurrency or Turnstile needs a human call. Stop after WP3 if claim/send-time design needs a call — better than shipping a double-texter.

---

## 7. Demo script (gate day)

1. Seed venue; staff console (`/inbox?view=service`) on desktop/iPad.
2. Phone Safari: `/book/the-test-kitchen` → book tomorrow.
3. Confirm screen: reference + manage link.
4. Email/SMS (or Worker logs if Resend/Telnyx unset in demo).
5. Console Today/Floor updates without refresh.
6. Manage → cancel → cancelled email; reminder rows `cancelled`; force a dispatcher tick → **no** reminder send.
7. Re-book → change time → changed email; new reminders scheduled at correct UTC.

---

## 8. Open risks (monitor, don’t block start)

| Risk | Mitigation |
|---|---|
| Soft waitlist exits feel unfinished | Clear “call us” copy; Phase 7 next |
| Confirmation waits on cron | Inline dispatch of due-now at reserve (WP7) |
| Telnyx outbound missing in template today | Port `pdc-phiof` `telnyx/send.ts` in WP2 — small, known |
| `sending` rows stuck after Worker kill | Stale-claim recovery at tick start (§3a) |
| BST off-by-one on reminders | `venue-time` helpers + clock-change test |

---

**Approval checkpoint:** Joachim signs off this revised plan → create `feat/guest-loop` from `main` and start WP0. Do not begin implementation before that sign-off (`CLAUDE.md`).
