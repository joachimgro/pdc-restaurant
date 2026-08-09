/**
 * Guest notification policy for Fennel / kitchen pilots.
 *
 * ## Reminder timing
 * - Confirmation email (+ SMS if ENABLE_BOOKING_SMS): due immediately at reserve
 *   (also flushed inline so it does not wait for cron).
 * - Reminder email: T−24h before `starts_at_utc`, then quiet-hours deferral.
 * - Reminder SMS: T−3h before `starts_at_utc`, then quiet-hours deferral.
 * - If T−24h / T−3h is already in the past at booking time, **no reminder is
 *   scheduled** (confirmation already covered the guest). There is no separate
 *   “minimum lead hours” flag beyond that.
 *
 * ## Quiet hours
 * Default venue-local **21:00–08:00** (overridable on venue settings).
 * Applies to **email and SMS reminders** and to **review request** scheduling.
 * A due time inside the window moves to the end of the window (usually 08:00).
 *
 * ## Review requests
 * Cron schedules one email when `finished_at + review_request_delay_hours`
 * (default 4h) has elapsed. That timestamp then goes through quiet hours **and**
 * a day window **09:00–20:00** local. Example: finish 22:00 → +4h = 02:00 →
 * quiet → 08:00 → day window → **09:00**.
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
 * ## Observability
 * `GET /health` includes `notificationQueue` counts, oldest due age, failed
 * last 24h. Health **503** when oldest due-unsent age &gt; 20 min (configurable
 * `NOTIFICATION_BACKLOG_ALERT_MINUTES`) or failed_24h &gt; 10
 * (`NOTIFICATION_FAILED_24H_ALERT`), same failure class as a dead cron.
 */
