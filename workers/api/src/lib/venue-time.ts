import {
  addDays,
  localToUtc,
  parseTime,
  venueLocalDate,
  venueLocalTime,
} from "../plugins/service/time";

/**
 * Quiet hours: 21:00–08:00 venue local.
 * Reminder SMS that would land in the window defers to next 08:00 venue local.
 */
export function deferIfQuietHours(
  when: Date,
  timeZone: string
): Date {
  const localTime = venueLocalTime(when, timeZone);
  const minutes = parseTime(localTime);
  const quietStart = 21 * 60;
  const quietEnd = 8 * 60;

  if (minutes >= quietStart || minutes < quietEnd) {
    const localDate = venueLocalDate(when, timeZone);
    // If we're already past midnight in quiet hours, 08:00 is today; if
    // evening quiet (21:00+), 08:00 is tomorrow.
    const targetDate =
      minutes >= quietStart ? addDays(localDate, 1) : localDate;
    return localToUtc(targetDate, "08:00", timeZone);
  }
  return when;
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
