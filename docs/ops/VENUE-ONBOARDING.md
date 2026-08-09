# Venue onboarding checklist

**Status:** live kitchen still carries the **demo seed** (`the-test-kitchen`, 3 rooms / 28 tables) until Fennel answers `FENNEL-VENUE-QUESTIONNAIRE.md` and a **new** venue is created. Verifying seed data is **not** Fennel onboarding.

Honest timing (2026-08-09):

| Activity | Time |
|----------|------|
| Confirm seed already present (rooms/tables/periods) | ~2 min — **not** Fennel go-live |
| Real Fennel onboarding (after questionnaire filled) | expect **25–45 min** first time: create location + settings, enter rooms/tables/combos, periods, turn/pacing, brand, smoke book |

## Prerequisites

- Wrangler logged in; Worker + D1 already exist for this stamp
- Resend + Turnstile + Telnyx secrets set (`TELNYX_WEBHOOK_PUBLIC_KEY` required for STOP)
- `ENABLE_DEMO_TOOLS=false` on live
- Questionnaire completed: `docs/ops/FENNEL-VENUE-QUESTIONNAIRE.md`

## Checklist (real venue)

1. **Create a new location + settings** — do **not** rename `the-test-kitchen`. New `booking_slug`, timezone, quiet hours, retention, contact, brand JSON.
2. **Floor** — rooms, tables, combinations matching Fennel’s plan.
3. **Service** — periods, turn rules, pacing for their service pattern.
4. **Leave seed** as a test target (`the-test-kitchen`) unless Fennel asks it deleted.
5. **Smoke** — `GET /book/<slug>/venue` 200; availability matches periods/turns; one hold+reserve with Turnstile; confirmation email/SMS.
6. **STOP** — follow `docs/ops/STOP-LIVE-PROOF.md` with a real phone.
7. Record elapsed wall-clock in the go-live note (not the seed verify time).

## Done when

- Booking URL is Fennel’s slug with Fennel’s floor and hours
- `/health` green on the SHA you deployed
- STOP proven on a real handset
- Seed venue is either kept as test or explicitly deleted — never mistaken for Fennel
