import { OCCUPYING_STATUSES, type Reservation } from "@lead-intake/shared-types";

/**
 * Table status on the service floor (spec §7).
 *
 * Colour is never the only signal: every state also carries a distinct badge
 * shape and a word in its accessible name, so the floor is readable by someone
 * who cannot distinguish amber from green — which in a dim room at 9pm is more
 * people than the contrast ratio suggests.
 */

export type TableStatus =
  | "free"
  | "upcoming"
  | "due"
  | "seated"
  | "over"
  | "late"
  | "blocked";

/** Distinct shape per state, so the badge alone identifies it. */
export type BadgeShape =
  | "none"
  | "clock"
  | "clock-filled"
  | "person"
  | "person-ring"
  | "exclamation"
  | "slash";

export const STATUS_META: Record<
  TableStatus,
  { label: string; badge: BadgeShape }
> = {
  free: { label: "Free", badge: "none" },
  upcoming: { label: "Booked", badge: "clock" },
  due: { label: "Arriving", badge: "clock-filled" },
  seated: { label: "Seated", badge: "person" },
  over: { label: "Over time", badge: "person-ring" },
  late: { label: "Overdue", badge: "exclamation" },
  blocked: { label: "Blocked", badge: "slash" },
};

/** Minutes either side of a booking's start that change how it reads. */
const DUE_WINDOW_MIN = 15;
const LATE_WINDOW_MIN = 15;

export function parseHHMM(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

export function formatHHMM(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60);
  const m = Math.round(totalMinutes % 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Statuses that hold a table — shared with the server's availability rules. */
export function occupies(reservation: Reservation): boolean {
  return (OCCUPYING_STATUSES as readonly string[]).includes(reservation.status);
}

/**
 * The booking sitting on a table at a given moment of the shift.
 *
 * `atMinutes` moves with the time scrubber; `nowMinutes` does not. Keeping
 * them separate is what lets a manager look at 20:30 without every table
 * suddenly reading as overdue.
 */
export function reservationAt(
  reservations: Reservation[],
  atMinutes: number
): Reservation | null {
  for (const r of reservations) {
    if (!occupies(r)) continue;
    const start = parseHHMM(r.startTime);
    const end = parseHHMM(r.endTime);
    if (atMinutes >= start && atMinutes < end) return r;
  }
  return null;
}

export function deriveTableStatus({
  reservation,
  nowMinutes,
  isBlocked = false,
}: {
  reservation: Reservation | null;
  nowMinutes: number;
  isBlocked?: boolean;
}): TableStatus {
  if (isBlocked) return "blocked";
  if (!reservation) return "free";

  const start = parseHHMM(reservation.startTime);
  const end = parseHHMM(reservation.endTime);

  if (reservation.status === "seated") {
    // Past its turn time: the kitchen and the next booking both care.
    return nowMinutes > end ? "over" : "seated";
  }

  if (reservation.status === "confirmed" || reservation.status === "pending_payment") {
    if (nowMinutes > start + LATE_WINDOW_MIN) return "late";
    if (start - nowMinutes <= DUE_WINDOW_MIN) return "due";
    return "upcoming";
  }

  // finished, cancelled, no_show, expired — the table is free again.
  return "free";
}

/**
 * Accessible name for a table on the service floor. Carries the status in
 * words, plus the booking, so nothing is conveyed by colour alone.
 */
export function serviceTableName(
  label: string,
  seats: string,
  status: TableStatus,
  reservation: Reservation | null
): string {
  const parts = [`Table ${label}`, `seats ${seats}`, STATUS_META[status].label];
  if (reservation) {
    parts.push(
      `${reservation.guestName}, ${reservation.partySize} covers at ${reservation.startTime}`
    );
    if (reservation.allergies) parts.push(`allergy: ${reservation.allergies}`);
  }
  return parts.join(", ");
}

/** Covers committed per pacing bucket, for the ribbon. */
export function pacingBuckets(
  reservations: Reservation[],
  intervalMin: number,
  fromMinutes: number,
  toMinutes: number
): { start: number; covers: number; bookings: number }[] {
  const buckets: { start: number; covers: number; bookings: number }[] = [];
  for (let t = fromMinutes; t < toMinutes; t += intervalMin) {
    buckets.push({ start: t, covers: 0, bookings: 0 });
  }

  for (const r of reservations) {
    if (!occupies(r)) continue;
    const start = parseHHMM(r.startTime);
    const index = Math.floor((start - fromMinutes) / intervalMin);
    if (index < 0 || index >= buckets.length) continue;
    buckets[index].covers += r.partySize;
    buckets[index].bookings += 1;
  }

  return buckets;
}

/** Non-dismissable tags that must stay high contrast (spec §12). */
export function allergyOf(reservation: Reservation): string | null {
  return reservation.allergies?.trim() || null;
}
