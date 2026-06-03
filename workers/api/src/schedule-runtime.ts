import type { Lead } from "@lead-intake/shared-types";
import type { Env } from "./env";
import {
  buildScheduleSummary,
  formatDaysPhrase,
  formatTimesPhrase,
  loadProgrammeSchedule,
  type ProgrammeSchedule,
  uniqueDaysFromSlots,
  uniqueTimesFromSlots,
} from "./db/location-schedules";

export type { ProgrammeSchedule };

export async function loadScheduleForLead(
  env: Env,
  lead: Pick<Lead, "locationId" | "interest">
): Promise<ProgrammeSchedule | null> {
  if (!lead.locationId) return null;
  return loadProgrammeSchedule(env, lead.locationId, lead.interest);
}

export function scheduleTimesOfferPhrase(schedule: ProgrammeSchedule): string {
  return formatTimesPhrase(uniqueTimesFromSlots(schedule.slots));
}

export function scheduleDaysOfferPhrase(schedule: ProgrammeSchedule): string {
  return formatDaysPhrase(uniqueDaysFromSlots(schedule.slots));
}

export function scheduleSummaryLine(schedule: ProgrammeSchedule): string {
  return buildScheduleSummary(schedule);
}

export function hasConfiguredSchedule(
  schedule: ProgrammeSchedule | null
): boolean {
  return Boolean(schedule && schedule.slots.length > 0);
}
