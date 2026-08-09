# Template vs restaurant — notification & guest-data divergence

Scope: guest notifications + guest PII paths only. Deliberate choices after H1–H2.

| Area | Template (`pdc-template`) | Restaurant / Fennel (`pdc-restaurant`) | Reason |
|------|---------------------------|----------------------------------------|--------|
| Schema | 0047 (waitlist production) | **0045** (quiet hours + retention + SMS suppressions; no 0046/0047) | Go-live needs STOP/retention/quiet hours; waitlist production schema deferred with flag off |
| SMS STOP | Real `sms_suppressions` + webhook keywords | **Same** (ported) | PECR obligation |
| SMS body opt-out line | May lack “Reply STOP…” | **Includes** “Reply STOP to opt out.” | Clear UK transactional affordance on live fork |
| Retention cron | Yes | **Yes** (ported) | GDPR retention |
| Guest erase/export | `/service/guests/erase`, `/export` | **Same** (ported) | Live fork must honour SAR/erasure |
| Quiet hours | Venue DB columns | **Same** (ported; defaults 21:00–08:00) | Fennel may change without code deploy |
| Waitlist notify | Wired with promote/expire (when ENABLE_WAITLIST) | **`ENABLE_WAITLIST=false` fail-closed**; UI hidden; API 404 | Half-wired waitlist would silently drop guest SMS — blocked for go-live |
| No-show auto mark | Cron `markNoShows` | Cron stub (no auto flip) | Console-driven for now; not guest-harm for notifications |
| Deposits / Stripe cancel refund | Present on template (when deposits on) | Deposits flag false; no refund-on-cancel path required | Out of go-live notification scope |
| Skip-rate health | Backlog + failed_24h | **Also skipped_24h + skippedByReason** | Ops needs skip spikes visible on live |
| GitHub Actions CI | Yes | **No workflow** — verify with local vitest + deploy | Historical fork gap; not notification drift |

Anything not listed above in notification/guest-data should be treated as **bug drift**, not intentional.
