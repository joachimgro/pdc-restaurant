/**
 * Guest notification policy for Fennel / kitchen pilots (pdc-restaurant).
 *
 * ## Reminder timing
 * - Confirmation email (+ SMS if ENABLE_BOOKING_SMS): due immediately at reserve
 *   (also flushed inline so it does not wait for cron).
 * - Reminder email: T−24h before `starts_at_utc`, then quiet-hours deferral
 *   (default release **08:00** local).
 * - Reminder SMS: T−**4h** before `starts_at_utc`, then SMS quiet-hours deferral
 *   with earliest send **07:00** local (so early-morning bookings do not text
 *   at 05:00, and dinner bookings fire mid-afternoon instead of one 08:00 pile).
 * - If T−24h / T−4h is already in the past at booking time, **no reminder is
 *   scheduled** (confirmation already covered the guest). There is no separate
 *   “minimum lead hours” flag beyond that.
 *
 * ## Quiet hours
 * Default venue-local **21:00–08:00** for **email** (and reviews), stored on
 * `venue_settings.quiet_hours_*`. **SMS reminders** use the same evening start
 * but release at **07:00** (`SMS_EARLIEST_LOCAL`), not the email 08:00 end.
 * A due time inside the window moves to the end of that window.
 *
 * ## Review requests
 * Cron schedules one email when `finished_at + review_request_delay_hours`
 * (default 4h) has elapsed. That timestamp then goes through quiet hours **and**
 * a day window **09:00–20:00** local. Example: finish 22:00 → +4h = 02:00 →
 * quiet → 08:00 → day window → **09:00**.
 *
 * ## SMS STOP (PECR)
 * Inbound STOP / STOPALL / UNSUBSCRIBE / CANCEL / END / QUIT adds the phone to
 * `sms_suppressions`. START / UNSTOP / YES removes it. Dispatcher and
 * `sendBookingSms` both skip suppressed numbers (`error_text=sms_suppressed`).
 * Outbound booking SMS bodies end with “Reply STOP to opt out.”
 *
 * ## Staleness (reminders only)
 * At send time, reminder templates (`reservation_reminder`,
 * `reservation_reminder_sms`) are **skipped** (status `skipped`, reason logged) if:
 * 1. `now >= starts_at_utc` (`reminder_past_start`), or
 * 2. `now - scheduled_for > REMINDER_STALE_MINUTES` (default **30**)
 *    (`reminder_stale`).
 * Confirmations, changes, cancellations, and review requests are **not**
 * subject to these rules — they still send late.
 *
 * ## Retries
 * Claim increments `attempts`. On provider failure: capped exponential backoff
 * with up to 60s jitter — **5 / 15 / 45 / 120** minutes — then terminal
 * `failed` at **MAX_ATTEMPTS = 5**. Exhausted rows do not re-enter the due set.
 *
 * ## Throughput ceiling (today)
 * Cron `*/5` × batch **50** ⇒ **600 sends/hour** per Worker/org.
 * Confirms also flush up to 10 inline at reserve.
 *
 * ## Waitlist
 * `ENABLE_WAITLIST=false` on this fork for Fennel go-live (fail-closed). Staff
 * console hides the Waitlist tab; API routes return 404. Do not re-enable until
 * waitlist notify templates share reservation quiet-hours / STOP / cancel-clear
 * rules.
 *
 * ## Observability
 * `GET /health` includes `notificationQueue` counts, oldest due age, failed_24h,
 * skipped_24h, and `skippedByReason` (past_start / stale / suppressed /
 * cancelled / …). Health **503** when oldest due-unsent age &gt; 20 min
 * (`NOTIFICATION_BACKLOG_ALERT_MINUTES`), failed_24h &gt; 10
 * (`NOTIFICATION_FAILED_24H_ALERT`), or skipped_24h &gt; 35
 * (`NOTIFICATION_SKIPPED_24H_ALERT`). Cron heartbeat is required (stale &gt;15m
 * also fails health).
 */
