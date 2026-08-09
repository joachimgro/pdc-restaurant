# Manual E2E — Fennel live (phone checklist)

**API:** `https://api.kitchen.phiof.digital`  
**Web:** `https://kitchen.phiof.digital`  
**Slug:** Fennel’s real slug (not `the-test-kitchen` once onboarded — see questionnaire)  
**From:** `admin@bookings.phiof.digital`  
**SMS number:** Telnyx `TELNYX_FROM_NUMBER` on Worker `pdc-restaurant`

Work top to bottom on your phone. Fill **Result**.

| # | Step | Correct looks like | Result |
|---|------|--------------------|--------|
| **1** | `GET /health` | HTTP 200, `"ok":true`; `version.gitSha` equals `git rev-parse --short HEAD` after last deploy; `expectedSchema` matches D1; `cron_heartbeat` has recent `last_ok`; `ENABLE_DEMO_TOOLS` off so seed is refused | □ |
| **2** | Open `/book/<fennel-slug>` | Branding + name are Fennel’s; party bounds match settings | □ |
| **3** | Availability for a real service day | Slots only inside Fennel periods; turn length matches their rules (not seed 90m unless that is theirs) | □ |
| **4** | Book party 2, ≥90 min out, real email + mobile, Turnstile | Reference + manage link | Ref: ______ |
| **5** | Email ≤2 min | From bookings domain; manage opens booking | □ |
| **6** | SMS ≤2 min | Body includes **Reply STOP to opt out.** | □ |
| **7** | Text **STOP** to booking number | Within a minute: row in `sms_suppressions` for your E.164, `source=stop` | □ |
| **8** | Force/wait due SMS reminder | `notifications` row `skipped` / `sms_suppressed`; `/health` skip reason `suppressed` | □ |
| **9** | Text **START** or **UNSTOP** | Suppression row gone | □ |
| **10** | Manage → modify | Success; old reminder cleared | □ |
| **11** | Manage → cancel; one cron tick | No further reminders | □ |
| **12** | Staff console Seat / Move | Works; SSE refresh after unlock | □ |
| **13** | Waitlist tab | **Absent** (`ENABLE_WAITLIST=false`) | □ |
| **14** | `POST /admin/seed` | **403** demo tools disabled | □ |
| **15** | Erase/export (admin secret) | Follow `docs/ops/C6-LIVE-PRIVACY-PROOF.md` | □ |

### Paste-back

```
health_sha:
fennel_slug:
reference:
email_ok:
sms_ok:
stop_row:
skip_suppressed:
start_cleared:
modify:
cancel:
waitlist_off:
seed_refused:
erase_export:
notes:
```
