import { DAYS, type DayCode } from "@lead-intake/shared-types";

/**
 * Venue-local date and time helpers. No date library — Intl is enough.
 *
 * A venue-local time is a "YYYY-MM-DD" date plus an "HH:MM" string, and the
 * two together are the source of truth. Never derive a local time by
 * formatting a UTC timestamp: on the October clock change the day is 23 hours
 * long and doing so silently produces an off-by-one service.
 *
 * Hours may exceed 23. A late bar closing at 01:30 stores "25:30" against its
 * opening day, because that is how venues count a shift.
 */

const HHMM = /^(\d{1,2}):(\d{2})$/;

/** "19:15" → 1155, "25:30" → 1530. Minutes since midnight on the opening day. */
export function parseTime(hhmm: string): number {
  const m = HHMM.exec(hhmm.trim());
  if (!m) throw new Error(`Invalid time "${hhmm}", expected HH:MM`);
  const hours = Number(m[1]);
  const minutes = Number(m[2]);
  if (minutes > 59) throw new Error(`Invalid minutes in "${hhmm}"`);
  // Hours past 47 are always a typo rather than a very late bar.
  if (hours > 47) throw new Error(`Invalid hours in "${hhmm}"`);
  return hours * 60 + minutes;
}

/** 1530 → "25:30". Overflow past midnight is preserved, never wrapped. */
export function formatTime(totalMinutes: number): string {
  if (!Number.isFinite(totalMinutes) || totalMinutes < 0) {
    throw new Error(`Cannot format negative time ${totalMinutes}`);
  }
  const hours = Math.floor(totalMinutes / 60);
  const minutes = Math.round(totalMinutes % 60);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

/** "23:30" + 120 → "25:30". Stays on the opening day rather than rolling over. */
export function addMinutes(hhmm: string, minutes: number): string {
  return formatTime(parseTime(hhmm) + minutes);
}

/** Minutes from `from` to `to`, both on the same opening day. */
export function minutesBetween(from: string, to: string): number {
  return parseTime(to) - parseTime(from);
}

/** True when `time` falls in [start, end). Handles 24h+ overflow times. */
export function isTimeWithin(time: string, start: string, end: string): boolean {
  const t = parseTime(time);
  return t >= parseTime(start) && t < parseTime(end);
}

/**
 * Day code for a calendar date. A date's weekday is the same in every zone —
 * "2026-10-25" is a Sunday everywhere — so no timezone is needed here.
 */
export function dayOfWeekForDate(date: string): DayCode {
  const [y, m, d] = splitDate(date);
  // getUTCDay(): 0 = Sunday. DAYS starts at Monday.
  const jsDay = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return DAYS[(jsDay + 6) % 7];
}

/** Add whole days to a "YYYY-MM-DD", staying in the calendar domain. */
export function addDays(date: string, days: number): string {
  const [y, m, d] = splitDate(date);
  const shifted = new Date(Date.UTC(y, m - 1, d + days));
  return `${shifted.getUTCFullYear()}-${pad2(
    shifted.getUTCMonth() + 1
  )}-${pad2(shifted.getUTCDate())}`;
}

/** The venue's current calendar date, which is not necessarily the UTC date. */
export function venueLocalDate(now: Date, timeZone: string): string {
  const parts = zoneParts(now.getTime(), timeZone);
  return `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}`;
}

/** The venue's current wall-clock time as "HH:MM". */
export function venueLocalTime(now: Date, timeZone: string): string {
  const parts = zoneParts(now.getTime(), timeZone);
  return `${pad2(parts.hour)}:${pad2(parts.minute)}`;
}

/**
 * Venue-local date + time → UTC instant, DST-correct.
 *
 * Used only for ordering and reminder scheduling. Display and availability
 * always use the local fields.
 *
 * Ambiguous times (the hour repeated when clocks go back) resolve to the
 * first occurrence — i.e. still on the pre-change offset — which is what a
 * guest booking "01:30" on that night means. Times skipped when clocks go
 * forward resolve to the instant the clock reaches the equivalent moment.
 */
export function localToUtc(date: string, hhmm: string, timeZone: string): Date {
  const total = parseTime(hhmm);
  // A 24h+ time belongs to the following calendar day at the same instant.
  const dayOffset = Math.floor(total / 1440);
  const minuteOfDay = total % 1440;
  const [y, m, d] = splitDate(date);

  const naive = Date.UTC(
    y,
    m - 1,
    d + dayOffset,
    Math.floor(minuteOfDay / 60),
    minuteOfDay % 60
  );

  // Try the offsets in force a day either side of the target: on a normal day
  // they agree, and across a transition they are the two candidate offsets. An
  // offset is correct when applying it lands on an instant that the zone maps
  // back to the same offset.
  const DAY_MS = 86_400_000;
  const candidateOffsets = [
    zoneOffsetMs(naive - DAY_MS, timeZone),
    zoneOffsetMs(naive + DAY_MS, timeZone),
  ];

  const valid: number[] = [];
  const tried = new Set<number>();
  for (const offset of candidateOffsets) {
    if (tried.has(offset)) continue;
    tried.add(offset);
    const instant = naive - offset;
    if (zoneOffsetMs(instant, timeZone) === offset) valid.push(instant);
  }

  // Ambiguous (clocks went back): take the first occurrence.
  if (valid.length > 0) return new Date(Math.min(...valid));

  // Skipped (clocks went forward over this local time): map to the instant
  // the clock reaches, rather than throwing at a manager mid-service.
  return new Date(naive - candidateOffsets[0]);
}

/** Convenience for storing `starts_at_utc`. */
export function localToUtcIso(
  date: string,
  hhmm: string,
  timeZone: string
): string {
  return localToUtc(date, hhmm, timeZone).toISOString();
}

/** Offset of `timeZone` from UTC, in ms, at the given instant. */
function zoneOffsetMs(utcMs: number, timeZone: string): number {
  const p = zoneParts(utcMs, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - utcMs;
}

type ZoneParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

function zoneParts(utcMs: number, timeZone: string): ZoneParts {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const found: Record<string, string> = {};
  for (const part of fmt.formatToParts(new Date(utcMs))) {
    if (part.type !== "literal") found[part.type] = part.value;
  }
  return {
    year: Number(found.year),
    month: Number(found.month),
    day: Number(found.day),
    // Some ICU builds render midnight as hour 24.
    hour: Number(found.hour) % 24,
    minute: Number(found.minute),
    second: Number(found.second),
  };
}

function splitDate(date: string): [number, number, number] {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
  if (!m) throw new Error(`Invalid date "${date}", expected YYYY-MM-DD`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}
