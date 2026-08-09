# Manual E2E — Fennel / kitchen live fork

**Target (live):** API `https://api.kitchen.phiof.digital` · Web `https://kitchen.phiof.digital` · slug **`the-test-kitchen`**  
**From address:** `admin@bookings.phiof.digital`  
**Do not use staging** for this checklist.

Work top to bottom. Fill **Result** as you go.

| # | Step | Correct looks like | Result |
|---|------|--------------------|--------|
| **0** | `GET https://api.kitchen.phiof.digital/health` | HTTP 200, `"ok": true`; `checks.cron_heartbeat` ok (or “no tick yet” only on brand-new deploy); `checks.notification_queue` ok; `version.expectedSchema` ≥ `0046`; `config_gate` ok | □ |
| **1** | Book on kitchen web: party 2, start **≥90 min from now**, real email + mobile, Turnstile | Reference + manage link | Ref: ______ |
| **2** | Within ~2 min: email | From `admin@bookings.phiof.digital`; manage link works; London times | Folder: ______ |
| **3** | SMS (ENABLE_BOOKING_SMS on) | Confirmation SMS includes **Reply STOP to opt out.** | SMS: ______ |
| **4** | Reminder proof (ops bump `scheduled_for` or wait real offset; cron `*/5`) | One reminder email (+ SMS); no duplicate | ______ |
| **5** | Manage → modify | Success; old reminder cleared; new reminder scheduled | ______ |
| **6** | Manage → cancel; wait one cron tick | Cancelled; **zero** further reminders | ______ |
| **7** | Text **STOP** to Telnyx From-number, then force a due SMS reminder | Zero SMS; notification `skipped` / `sms_suppressed` | ______ |
| **7b** | Text **START** or **UNSTOP** | Suppression cleared (optional proof) | ______ / SKIP |
| **8** | Staff console: Seat / No-show / Move | Works one-handed; list refreshes | ______ |
| **9** | Lock phone 30s → unlock | Day refreshes; no stale stuck UI | ______ |
| **10** | Waitlist tab | **Absent** (`ENABLE_WAITLIST=false`). Deep link `?view=waitlist` falls back to Today. API `/service/waitlist` → 404 | □ confirmed off |
| **11** | Erase proof (admin secret or staff session): `POST /service/guests/erase` with test email | `{ ok: true, result: … }`; export empty of live PII | ______ |
| **12** | Export: `GET /service/guests/export?email=…` before erase | JSON with reservations / notifications for that guest | ______ |

### Paste-back

```
health:
reference:
email_folder:
sms_confirmation:
reminder:
modify:
cancel_post_sends:
stop:
staff_actions:
sse_resume:
waitlist_off: yes
erase:
export:
notes:
```
