# Template vs restaurant — notification & guest-data divergence

Scope: guest notifications + guest PII paths only. Deliberate choices after H1–H2 / C4.

| Area | Template (`pdc-template`) | Restaurant / Fennel (`pdc-restaurant`) | Reason |
|------|---------------------------|----------------------------------------|--------|
| Schema | **0047** | **0046** | **Deliberate.** 0047 only adds `venue_settings.waitlist_notify_ttl_min` for waitlist notify TTL. Live has `ENABLE_WAITLIST=false`; applying 0047 without waitlist product wiring adds dead config. Do **not** apply 0047 until waitlist is re-enabled as a product decision. |
| SMS STOP | Real `sms_suppressions` + webhook keywords | **Same** (ported) | PECR obligation |
| SMS body opt-out line | May lack “Reply STOP…” | **Includes** “Reply STOP to opt out.” | Clear UK transactional affordance on live fork |
| Retention cron | Yes | **Yes** (ported) | GDPR retention |
| Guest erase/export | `/service/guests/erase`, `/export` | **Same** (ported) | Live fork must honour SAR/erasure |
| Quiet hours | Venue DB columns | **Same** (ported; defaults 21:00–08:00) | Fennel may change without code deploy |
| Waitlist notify | Wired with promote/expire (when ENABLE_WAITLIST) | **`ENABLE_WAITLIST=false` fail-closed**; UI hidden | Half-wired waitlist would silently drop guest SMS — blocked for go-live |
| No-show auto mark | Cron `markNoShows` | Cron stub (no auto flip) | Console-driven for now; not guest-harm for notifications |
| Deposits / Stripe cancel refund | Present on template (when deposits on) | Deposits flag false; no refund-on-cancel path required | Out of go-live notification scope |
| Skip-rate health | Backlog + failed_24h | **Also skipped_24h + skippedByReason** | Ops needs skip spikes visible on live |
| GitHub Actions CI | Yes | **Yes** (ported C5) | Same typecheck + vitest + broken-migration gate |

## Enforcing schema non-drift

1. `EXPECTED_SCHEMA_VERSION` in this fork must match the highest migration **in this repo**, not template’s tip.
2. CI `meta.test.ts` + `d1-harness` fail if the constant and migration files disagree.
3. Staging (template) and live (restaurant) **may** differ only when listed above with a reason. Any other gap is a bug.
4. When waitlist is re-enabled: port 0047 (+ product code) in the **same** PR that flips `ENABLE_WAITLIST=true`.

Anything not listed above in notification/guest-data should be treated as **bug drift**, not intentional.
