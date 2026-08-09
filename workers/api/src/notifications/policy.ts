/**
 * Guest-notification policy constants and pure helpers.
 * Keep behaviour documented in docs/ops/NOTIFICATION-POLICY.md.
 */

/** Reminder templates subject to staleness + past-start skip rules. */
export const REMINDER_TEMPLATES = new Set([
  "reservation_reminder",
  "reservation_reminder_sms",
]);

/**
 * Templates that must still send late (carry information regardless of timing).
 * Explicitly NOT subject to reminder staleness / past-start skips:
 *   reservation_confirmed, reservation_changed, reservation_cancelled,
 *   review_request, waitlist_*.
 */

export const REMINDER_STALE_MINUTES_DEFAULT = 30;
export const MAX_ATTEMPTS = 5;
/** Backoff after attempt 1..4 before the next retry; attempt 5 → failed. */
export const RETRY_BACKOFF_MINUTES = [5, 15, 45, 120] as const;
export const REVIEW_DAY_WINDOW = { start: "09:00", end: "20:00" } as const;
export const QUEUE_BACKLOG_ALERT_MINUTES_DEFAULT = 20;
export const QUEUE_FAILED_24H_ALERT_DEFAULT = 10;
export const QUEUE_SKIPPED_24H_ALERT_DEFAULT = 35;

export function isReminderTemplate(template: string): boolean {
  return REMINDER_TEMPLATES.has(template);
}

export type ReminderSkipReason = "reminder_past_start" | "reminder_stale";

/**
 * Reminder skip rules (confirmations / cancellations / changed / review are exempt):
 * 1. now >= starts_at_utc → reminder_past_start
 * 2. now - scheduled_for > staleMinutes → reminder_stale
 */
export function reminderSkipReason(
  template: string,
  now: Date,
  scheduledForIso: string | null | undefined,
  startsAtUtc: string | null | undefined,
  staleMinutes: number = REMINDER_STALE_MINUTES_DEFAULT
): ReminderSkipReason | null {
  if (!isReminderTemplate(template)) return null;

  if (startsAtUtc) {
    const startMs = new Date(startsAtUtc).getTime();
    if (!Number.isNaN(startMs) && now.getTime() >= startMs) {
      return "reminder_past_start";
    }
  }

  if (scheduledForIso) {
    const dueMs = new Date(scheduledForIso).getTime();
    if (
      !Number.isNaN(dueMs) &&
      now.getTime() - dueMs > staleMinutes * 60 * 1000
    ) {
      return "reminder_stale";
    }
  }

  return null;
}

/**
 * After a failed claim (attempts already incremented), schedule the next try.
 * Returns null when attempts >= MAX_ATTEMPTS (caller should mark failed).
 */
export function nextRetryScheduledFor(
  attempts: number,
  now: Date,
  jitterMs: () => number = defaultJitterMs
): Date | null {
  if (attempts >= MAX_ATTEMPTS) return null;
  const idx = Math.min(attempts - 1, RETRY_BACKOFF_MINUTES.length - 1);
  const minutes = RETRY_BACKOFF_MINUTES[Math.max(0, idx)]!;
  return new Date(now.getTime() + minutes * 60_000 + jitterMs());
}

function defaultJitterMs(): number {
  return Math.floor(Math.random() * 60_000);
}

export function reminderStaleMinutesFromEnv(env: {
  REMINDER_STALE_MINUTES?: string;
}): number {
  const n = Number(env.REMINDER_STALE_MINUTES);
  return Number.isFinite(n) && n > 0 ? n : REMINDER_STALE_MINUTES_DEFAULT;
}

export function backlogAlertMinutesFromEnv(env: {
  NOTIFICATION_BACKLOG_ALERT_MINUTES?: string;
}): number {
  const n = Number(env.NOTIFICATION_BACKLOG_ALERT_MINUTES);
  return Number.isFinite(n) && n > 0 ? n : QUEUE_BACKLOG_ALERT_MINUTES_DEFAULT;
}

export function failed24hAlertFromEnv(env: {
  NOTIFICATION_FAILED_24H_ALERT?: string;
}): number {
  const n = Number(env.NOTIFICATION_FAILED_24H_ALERT);
  return Number.isFinite(n) && n >= 0 ? n : QUEUE_FAILED_24H_ALERT_DEFAULT;
}

export function skipped24hAlertFromEnv(env: {
  NOTIFICATION_SKIPPED_24H_ALERT?: string;
}): number {
  const n = Number(env.NOTIFICATION_SKIPPED_24H_ALERT);
  return Number.isFinite(n) && n >= 0 ? n : QUEUE_SKIPPED_24H_ALERT_DEFAULT;
}

/** Normalise error_text into a coarse skip-reason bucket for ops. */
export function classifySkipReason(errorText: string | null | undefined): string {
  const t = (errorText ?? "").toLowerCase();
  if (t.includes("past_start")) return "past_start";
  if (t.includes("stale")) return "stale";
  if (t.includes("suppress")) return "suppressed";
  if (t.includes("cancel")) return "cancelled";
  if (t.includes("quiet")) return "quiet_hours";
  return t ? "other" : "unknown";
}
