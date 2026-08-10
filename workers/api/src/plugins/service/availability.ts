import type {
  AvailabilityException,
  PacingRule,
  ServicePeriod,
  TableCombination,
  TurnTimeRule,
  VenueSettings,
} from "@lead-intake/shared-types";
import { assignTables, type AssignableTable, type TableAssignment } from "./assignment";
import {
  addMinutes,
  parseTime,
  venueLocalDate,
  venueLocalTime,
} from "./time";

/**
 * Availability engine. PURE — no database, no ambient clock. `now` is an
 * argument, occupancy is loaded by the caller. Load first, compute second.
 *
 * All reasoning is in venue-local `YYYY-MM-DD` + `HH:MM`. Nothing here derives
 * a local time from a UTC timestamp: on the October clock change that produces
 * a 23-hour day and an off-by-one service.
 */

export type UnavailableReason =
  | "closed"
  | "past"
  | "too_soon"
  | "too_far"
  | "after_last_seating"
  | "no_table"
  | "pacing_full"
  | "party_too_large"
  | "staff_only";

/**
 * One occupied table-window, or one unassigned booking.
 *
 * `tableId` is null for a reservation with no table yet. Those rows exist
 * because the occupancy query LEFT JOINs its table rows: an unassigned staff
 * booking still consumes pacing, and an INNER JOIN would drop it silently.
 */
export type OccupancyRow = {
  /** Reservation or hold id. Two tables on one booking share this id. */
  sourceId: string;
  kind: "reservation" | "hold";
  tableId: string | null;
  startTime: string;
  endTime: string;
  partySize: number;
};

export interface AvailabilityInput {
  settings: VenueSettings;
  /** Active periods for this weekday, each carrying its own scoped rules. */
  periods: ServicePeriod[];
  venueTurnRules: TurnTimeRule[];
  venuePacingRules: PacingRule[];
  exceptions: AvailabilityException[];
  tables: AssignableTable[];
  combinations: TableCombination[];
  occupancy: OccupancyRow[];
  serviceDate: string;
  partySize: number;
  now: Date;
  channel: "online" | "staff";
  roomIds?: string[];
}

export interface AvailabilitySlot {
  time: string;
  periodId: string;
  available: boolean;
  endTime: string;
  turnMinutes: number;
  assignment: TableAssignment | null;
  remainingCovers: number | null;
  reason?: UnavailableReason;
}

/** `NOT (a.end <= b.start OR a.start >= b.end)` — adjacency is not overlap.
 *  A party leaving at 19:00 frees the table for a 19:00 booking. */
function overlaps(
  aStart: string,
  aEnd: string,
  bStart: string,
  bEnd: string
): boolean {
  return !(parseTime(aEnd) <= parseTime(bStart) || parseTime(aStart) >= parseTime(bEnd));
}

/**
 * Most specific turn rule wins: a period-scoped rule beats a venue-scoped one,
 * and within either, a narrower party range beats a wider one.
 */
function resolveTurnMinutes(
  partySize: number,
  period: ServicePeriod,
  venueTurnRules: TurnTimeRule[],
  settings: VenueSettings
): number {
  const narrowest = (rules: TurnTimeRule[]): TurnTimeRule | null => {
    const matching = rules.filter(
      (r) => partySize >= r.partyMin && partySize <= r.partyMax
    );
    if (matching.length === 0) return null;
    return [...matching].sort(
      (a, b) =>
        a.partyMax - a.partyMin - (b.partyMax - b.partyMin) ||
        a.id.localeCompare(b.id)
    )[0];
  };

  return (
    narrowest(period.turnRules)?.turnMinutes ??
    narrowest(venueTurnRules)?.turnMinutes ??
    settings.defaultTurnMinutes
  );
}

/** Exception applies to the whole day when it carries no time window. */
function exceptionCoversWindow(
  exception: AvailabilityException,
  start: string,
  end: string
): boolean {
  if (!exception.startTime || !exception.endTime) return true;
  return overlaps(exception.startTime, exception.endTime, start, end);
}

export function computeAvailability(
  input: AvailabilityInput
): AvailabilitySlot[] {
  const {
    settings,
    periods,
    venueTurnRules,
    venuePacingRules,
    exceptions,
    tables,
    combinations,
    occupancy,
    serviceDate,
    partySize,
    now,
    channel,
    roomIds,
  } = input;

  const dayClosed = exceptions.some((e) => e.kind === "closed");

  const partyOutsideOnlineBounds =
    channel === "online" &&
    (partySize < settings.minPartyOnline ||
      partySize > settings.maxPartyCombined);

  const requiresCombination =
    channel === "online" && partySize > settings.maxPartyOnline;

  // ── Indexes built once, before the slot loop ──────────────────────────────
  // This is what keeps the engine flat rather than N+1: every slot reads these
  // maps instead of re-scanning the occupancy list.

  const busyByTable = new Map<string, { start: string; end: string }[]>();
  for (const row of occupancy) {
    if (!row.tableId) continue;
    const list = busyByTable.get(row.tableId);
    const entry = { start: row.startTime, end: row.endTime };
    if (list) list.push(entry);
    else busyByTable.set(row.tableId, [entry]);
  }

  /**
   * Pacing counts bookings, not table-rows. A booking sitting on two joined
   * tables produces two occupancy rows, and counting both would charge a
   * 12-cover party as 24 against the cap.
   */
  const committedById = new Map<
    string,
    { startTime: string; partySize: number }
  >();
  for (const row of occupancy) {
    if (!committedById.has(row.sourceId)) {
      committedById.set(row.sourceId, {
        startTime: row.startTime,
        partySize: row.partySize,
      });
    }
  }
  const committed = [...committedById.values()];

  const blockedTableIds = new Set<string>();
  const blockedRoomIds = new Set<string>();
  for (const e of exceptions) {
    if (e.kind === "block_table" && e.tableId) blockedTableIds.add(e.tableId);
    if (e.kind === "block_room" && e.roomId) blockedRoomIds.add(e.roomId);
  }

  const todayLocal = venueLocalDate(now, settings.timezone);
  const nowLocalMinutes = parseTime(venueLocalTime(now, settings.timezone));
  const daysAhead = daysBetweenDates(todayLocal, serviceDate);

  const slots: AvailabilitySlot[] = [];

  for (const period of [...periods].sort(
    (a, b) => a.sortOrder - b.sortOrder || parseTime(a.startTime) - parseTime(b.startTime)
  )) {
    if (!period.isActive) continue;

    // special_hours overrides the period's own times for this date.
    const special = exceptions.find((e) => e.kind === "special_hours");
    const startTime = special?.startTime ?? period.startTime;
    const lastSeating =
      special?.overrideLastSeating ?? special?.endTime ?? period.lastSeatingTime;
    const endOfService = special?.endTime ?? period.endTime;

    const noOnlineException = exceptions.some((e) => e.kind === "no_online");
    const staffOnly =
      channel === "online" && (!period.onlineBookable || noOnlineException);

    const interval = period.slotIntervalMin ?? settings.slotIntervalMin;
    const lastSeatingMin = parseTime(lastSeating);

    for (
      let t = parseTime(startTime);
      t <= lastSeatingMin;
      t += Math.max(1, interval)
    ) {
      const time = minutesToTime(t);
      const turnMinutes = resolveTurnMinutes(
        partySize,
        period,
        venueTurnRules,
        settings
      );
      const endTime = addMinutes(time, turnMinutes);

      const base = {
        time,
        periodId: period.id,
        endTime,
        turnMinutes,
        assignment: null,
        remainingCovers: null,
      };

      const unavailable = (reason: UnavailableReason): AvailabilitySlot => ({
        ...base,
        available: false,
        reason,
      });

      if (dayClosed) {
        slots.push(unavailable("closed"));
        continue;
      }
      if (partyOutsideOnlineBounds) {
        slots.push(unavailable("party_too_large"));
        continue;
      }
      if (staffOnly) {
        slots.push(unavailable("staff_only"));
        continue;
      }

      // Past and lead time, in venue-local terms only.
      if (daysAhead < 0) {
        slots.push(unavailable("past"));
        continue;
      }
      if (daysAhead === 0 && t < nowLocalMinutes) {
        slots.push(unavailable("past"));
        continue;
      }
      if (daysAhead === 0 && t < nowLocalMinutes + settings.minLeadMinutes) {
        slots.push(unavailable("too_soon"));
        continue;
      }
      if (daysAhead > settings.maxAdvanceDays) {
        slots.push(unavailable("too_far"));
        continue;
      }

      // The turn may run past close, but only into the grace window.
      if (
        parseTime(endTime) >
        parseTime(endOfService) + settings.graceAfterCloseMin
      ) {
        slots.push(unavailable("after_last_seating"));
        continue;
      }

      const freeTables = tables.filter((table) => {
        if (!table.isActive) return false;
        if (blockedTableIds.has(table.id) || blockedRoomIds.has(table.roomId)) {
          return false;
        }
        const busy = busyByTable.get(table.id);
        if (busy?.some((b) => overlaps(b.start, b.end, time, endTime))) {
          return false;
        }
        return true;
      });

      const assignment = assignTables(freeTables, combinations, partySize, {
        channel,
        preferredRoomIds: roomIds,
        reserveLargeTables: channel === "online",
      });

      if (
        !assignment ||
        (requiresCombination && !assignment.combinationId)
      ) {
        slots.push(unavailable("no_table"));
        continue;
      }

      const pacing = evaluatePacing(
        t,
        partySize,
        period,
        venuePacingRules,
        committed
      );

      if (!pacing.allowed) {
        slots.push({
          ...unavailable("pacing_full"),
          remainingCovers: pacing.remainingCovers,
        });
        continue;
      }

      slots.push({
        ...base,
        available: true,
        assignment,
        remainingCovers: pacing.remainingCovers,
      });
    }
  }

  return slots;
}

/**
 * Pacing is counted by booking start-time bucket, not by occupancy: it exists
 * to stop twelve tables ordering at once, which is a kitchen problem rather
 * than a floor one.
 */
function evaluatePacing(
  slotMinutes: number,
  partySize: number,
  period: ServicePeriod,
  venuePacingRules: PacingRule[],
  committed: { startTime: string; partySize: number }[]
): { allowed: boolean; remainingCovers: number | null } {
  const rules = (
    period.pacingRules.length > 0 ? period.pacingRules : venuePacingRules
  ).filter((r) => r.isActive);

  let remainingCovers: number | null = null;
  let allowed = true;

  for (const rule of rules) {
    if (rule.appliesFrom && slotMinutes < parseTime(rule.appliesFrom)) continue;
    if (rule.appliesTo && slotMinutes >= parseTime(rule.appliesTo)) continue;

    const interval = Math.max(1, rule.intervalMin);
    const bucket = Math.floor(slotMinutes / interval);

    let covers = 0;
    let bookings = 0;
    for (const c of committed) {
      if (Math.floor(parseTime(c.startTime) / interval) !== bucket) continue;
      covers += c.partySize;
      bookings += 1;
    }

    if (rule.maxCovers !== null) {
      const left = rule.maxCovers - covers;
      remainingCovers =
        remainingCovers === null ? left : Math.min(remainingCovers, left);
      if (covers + partySize > rule.maxCovers) allowed = false;
    }
    if (rule.maxBookings !== null && bookings + 1 > rule.maxBookings) {
      allowed = false;
    }
  }

  return { allowed, remainingCovers };
}

/** Minutes-since-opening-day back to "HH:MM", preserving 24h+ overflow. */
function minutesToTime(total: number): string {
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

/** Whole days from `from` to `to`, both "YYYY-MM-DD". Calendar arithmetic
 *  only — no timezone is involved in the gap between two dates. */
function daysBetweenDates(from: string, to: string): number {
  const parse = (d: string) => {
    const [y, m, day] = d.split("-").map(Number);
    return Date.UTC(y, m - 1, day);
  };
  return Math.round((parse(to) - parse(from)) / 86_400_000);
}

/** Re-exported so callers building occupancy rows share one vocabulary. */
export type { TableAssignment, AssignableTable };
