import {
  addDays,
  localToUtc,
  parseTime,
  venueLocalDate,
  venueLocalTime,
} from "../plugins/service/time";
import { REVIEW_DAY_WINDOW } from "../notifications/policy";

/**
 * Quiet hours: 21:00–08:00 venue local by default, overridable per venue.
 * A send that would land in the window defers to the end of the window.
 */
export function deferIfQuietHours(
  when: Date,
  timeZone: string,
  opts?: { start?: string; end?: string }
): Date {
  const start = opts?.start ?? "21:00";
  const end = opts?.end ?? "08:00";
  const localTime = venueLocalTime(when, timeZone);
  const minutes = parseTime(localTime);
  const quietStart = parseTime(start);
  const quietEnd = parseTime(end);

  const wraps = quietStart > quietEnd;
  const inQuietHours = wraps
    ? minutes >= quietStart || minutes < quietEnd
    : minutes >= quietStart && minutes < quietEnd;

  if (!inQuietHours) return when;

  const localDate = venueLocalDate(when, timeZone);
  const targetDate =
    wraps && minutes >= quietStart ? addDays(localDate, 1) : localDate;
  return localToUtc(targetDate, end, timeZone);
}

/**
 * Guest-facing send window: first apply quiet hours, then clamp into a
 * sane local day window (default 09:00–20:00) so review requests never
 * land at 02:00 after quiet-hours release at 08:00.
 */
export function deferToGuestSendWindow(
  when: Date,
  timeZone: string,
  opts?: {
    quietStart?: string;
    quietEnd?: string;
    dayStart?: string;
    dayEnd?: string;
  }
): Date {
  const dayStart = opts?.dayStart ?? REVIEW_DAY_WINDOW.start;
  const dayEnd = opts?.dayEnd ?? REVIEW_DAY_WINDOW.end;

  let t = deferIfQuietHours(when, timeZone, {
    start: opts?.quietStart,
    end: opts?.quietEnd,
  });

  for (let i = 0; i < 3; i++) {
    const localTime = venueLocalTime(t, timeZone);
    const minutes = parseTime(localTime);
    const startM = parseTime(dayStart);
    const endM = parseTime(dayEnd);
    const localDate = venueLocalDate(t, timeZone);

    if (minutes < startM) {
      t = localToUtc(localDate, dayStart, timeZone);
      continue;
    }
    if (minutes >= endM) {
      t = localToUtc(addDays(localDate, 1), dayStart, timeZone);
      // Next day's 09:00 is outside quiet hours for default 21–08.
      continue;
    }
    break;
  }

  return t;
}

export function guestBookingOrigin(env: {
  GUEST_BOOKING_ORIGIN?: string;
  AUTH_WEB_ORIGIN?: string;
  CORS_ORIGIN: string;
}): string {
  const explicit = env.GUEST_BOOKING_ORIGIN?.trim();
  if (explicit) return explicit.replace(/\/$/, "");
  const auth = env.AUTH_WEB_ORIGIN?.trim();
  if (auth) return auth.replace(/\/$/, "");
  const first = env.CORS_ORIGIN.split(",")[0]?.trim();
  return (first || "http://localhost:3000").replace(/\/$/, "");
}
