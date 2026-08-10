import type { Reservation } from "@lead-intake/shared-types";
import { parseHHMM } from "./status";

/** Width of one hour on the horizontal axis. */
export const HOUR_WIDTH_PX = 120;
export const LANE_HEIGHT_PX = 56;
export const SLOT_MIN = 15;

export type LayoutedReservation = {
  reservation: Reservation;
  /** px from left edge of the time grid */
  left: number;
  /** px width */
  width: number;
  /** lane index (0-based row) */
  lane: number;
};

type Timed = {
  reservation: Reservation;
  start: number;
  end: number;
};

function overlaps(a: Timed, b: Timed): boolean {
  return a.start < b.end && b.start < a.end;
}

/**
 * Pack bookings into horizontal lanes for a time-across-top calendar.
 * Same-time overlaps get different lanes so every guest is visible.
 */
export function layoutSwimlanes(
  reservations: Reservation[],
  gridStart: number
): { items: LayoutedReservation[]; laneCount: number } {
  if (reservations.length === 0) return { items: [], laneCount: 0 };

  const timed: Timed[] = reservations.map((reservation) => ({
    reservation,
    start: parseHHMM(reservation.startTime),
    end: Math.max(
      parseHHMM(reservation.endTime),
      parseHHMM(reservation.startTime) + SLOT_MIN
    ),
  }));
  timed.sort((a, b) => a.start - b.start || a.end - b.end);

  const lanes: Timed[][] = [];
  const laneOf = new Map<Timed, number>();

  for (const ev of timed) {
    let placed = false;
    for (let i = 0; i < lanes.length; i++) {
      const lane = lanes[i];
      if (lane.every((existing) => !overlaps(existing, ev))) {
        lane.push(ev);
        laneOf.set(ev, i);
        placed = true;
        break;
      }
    }
    if (!placed) {
      laneOf.set(ev, lanes.length);
      lanes.push([ev]);
    }
  }

  const items = timed.map((ev) => {
    const lane = laneOf.get(ev) ?? 0;
    const left = ((ev.start - gridStart) / 60) * HOUR_WIDTH_PX;
    const width = Math.max(
      ((ev.end - ev.start) / 60) * HOUR_WIDTH_PX,
      72
    );
    return { reservation: ev.reservation, left, width, lane };
  });

  return { items, laneCount: lanes.length };
}

export function hourLabelsBetween(fromMin: number, toMin: number): string[] {
  const startHour = Math.floor(fromMin / 60);
  const endHour = Math.ceil(toMin / 60);
  const labels: string[] = [];
  for (let h = startHour; h < endHour; h++) {
    const suffix = h >= 12 ? "PM" : "AM";
    const hour12 = h % 12 || 12;
    labels.push(`${hour12} ${suffix}`);
  }
  return labels;
}

export function formatTimeRange(start: string, end: string): string {
  const fmt = (t: string) => {
    const [h, m] = t.split(":").map(Number);
    const suffix = h >= 12 ? "pm" : "am";
    const hour12 = h % 12 || 12;
    if (!m) return `${hour12}${suffix}`;
    return `${hour12}:${String(m).padStart(2, "0")}${suffix}`;
  };
  return `${fmt(start)} – ${fmt(end)}`;
}
