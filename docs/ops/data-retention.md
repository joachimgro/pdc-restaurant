# Guest data retention & erasure

**Status:** see git. Plain English for venue operators.

## What we store

When someone books (or joins a waitlist / messages about a booking), we keep:

| What | Where it lives | Why |
|------|----------------|-----|
| Name, email, phone | Booking / waitlist / message thread | Confirm, remind, manage the visit |
| Allergies & guest notes | Booking + guest profile | Service the table safely |
| Message bodies | Guest inbox threads | Staff reply history |
| Notification addresses | Outbound email/SMS log | Prove what we sent |
| Visit / no-show counts | Guest profile | Ops reliability (not marketing lists) |

We do **not** sell guest data. Marketing opt-in is stored only when the guest ticks it; this pilot does not run marketing campaigns.

## How long we keep personal details

Default: **24 months** after the booking’s start time (venue setting `retentionMonths`, 1–120).

After that, a nightly job **anonymises** the guest:

- Name becomes “Former guest”
- Email, phone, allergies, and free-text notes are cleared
- Message bodies become `[redacted]`
- Manage links are revoked
- Contact identity records are removed

**What stays:** party size, date/time, status (finished / cancelled / no-show), table history — so your covers, no-show rate, and similar stats stay correct.

## Erasing someone on request (GDPR erasure)

Staff (or an operator with the admin secret) can wipe a guest by email or phone:

- `POST /service/guests/erase` with `{ "email": "…" }` or `{ "phone": "…" }`
- Covers bookings, waitlist, threads, messages, profiles, notifications, and manage tokens

## Subject access (export)

- `GET /service/guests/export?email=…` or `?phone=…`
- Returns JSON of everything we hold for that guest at that moment

## SMS STOP

If a guest texts **STOP** (or STOPALL / UNSUBSCRIBE / CANCEL / END / QUIT) to the booking SMS number, we add their phone to a suppression list. Reminder and confirmation SMS will not send to that number until they text **START** or **UNSTOP**.

## Who to ask

Operational wipe / export: venue manager or Phiof support. Technical detail: see git history for the retention and privacy modules.
