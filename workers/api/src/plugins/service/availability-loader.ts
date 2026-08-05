import type { AvailabilityException } from "@lead-intake/shared-types";
import type { Env } from "../../env";
import {
  computeAvailability,
  type AvailabilityInput,
  type AvailabilitySlot,
} from "./availability";
import type { AssignableTable } from "./assignment";
import { listExceptions } from "./db/exceptions";
import { listServicePeriods } from "./db/periods";
import { loadOccupancy } from "./db/reservations";
import { getFloorPlan } from "./db/tables";
import { getVenueSettings } from "./db/venue";
import { dayOfWeekForDate } from "./time";

/**
 * The impure half of availability: load everything the engine needs, then
 * hand it over. Every query here is per-request and flat — nothing runs per
 * slot or per table.
 *
 * Kept out of availability.ts so that file stays database-free and
 * unit-testable, which engine-boundary.test.ts enforces.
 */
export async function loadAvailability(
  env: Env,
  locationId: string,
  params: {
    serviceDate: string;
    partySize: number;
    channel: "online" | "staff";
    now: Date;
    roomIds?: string[];
  }
): Promise<{ slots: AvailabilitySlot[]; input: AvailabilityInput } | null> {
  const settings = await getVenueSettings(env, locationId);
  if (!settings) return null;

  const [periodsResponse, plan, exceptions, occupancy] = await Promise.all([
    listServicePeriods(env, locationId),
    getFloorPlan(env, locationId),
    listExceptions(env, locationId, params.serviceDate, params.serviceDate),
    loadOccupancy(env, locationId, params.serviceDate),
  ]);

  const weekday = dayOfWeekForDate(params.serviceDate);

  // Flatten rooms → tables, carrying roomId, which the nested wire shape
  // implies but the assignment engine needs explicitly for room preference.
  const tables: AssignableTable[] = plan.rooms
    .filter((room) => room.isActive)
    .flatMap((room) =>
      room.tables.map((table) => ({ ...table, roomId: room.id }))
    );

  const input: AvailabilityInput = {
    settings,
    periods: periodsResponse.periods.filter(
      (p) => p.isActive && p.dayOfWeek === weekday
    ),
    venueTurnRules: periodsResponse.venueTurnRules,
    venuePacingRules: periodsResponse.venuePacingRules,
    exceptions: exceptions as AvailabilityException[],
    tables,
    combinations: plan.combinations.filter((c) => c.isActive),
    occupancy,
    serviceDate: params.serviceDate,
    partySize: params.partySize,
    now: params.now,
    channel: params.channel,
    roomIds: params.roomIds,
  };

  return { slots: computeAvailability(input), input };
}

/**
 * Alternatives offered alongside a 409 SLOT_TAKEN.
 *
 * A bare conflict tells a guest their booking failed and nothing else; the
 * recovery is the point of the response. Nearest-first by absolute distance
 * from the time they asked for, because 19:15 is a better consolation for a
 * lost 19:00 than 21:30 is.
 */
export function nearestAlternatives(
  slots: AvailabilitySlot[],
  wantedTime: string,
  limit = 4
): AvailabilitySlot[] {
  const minutes = (hhmm: string) => {
    const [h, m] = hhmm.split(":").map(Number);
    return h * 60 + m;
  };
  const target = minutes(wantedTime);

  return slots
    .filter((s) => s.available && s.time !== wantedTime)
    .sort(
      (a, b) =>
        Math.abs(minutes(a.time) - target) - Math.abs(minutes(b.time) - target) ||
        a.time.localeCompare(b.time)
    )
    .slice(0, limit);
}
