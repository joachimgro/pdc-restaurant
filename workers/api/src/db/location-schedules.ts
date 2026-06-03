import type { Env } from "../env";

export interface ScheduleRow {
  id: string;
  organization_id: string;
  location_id: string;
  programme: string;
  day_of_week: string;
  start_time: string;
  display_label: string;
  sort_order: number;
}

export interface ProgrammeScheduleSlot {
  dayOfWeek: string;
  startTime: string;
  displayLabel: string;
  sortOrder: number;
}

export interface ProgrammeSchedule {
  locationId: string;
  programme: string;
  slots: ScheduleRow[];
}

const DAY_ORDER = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

export function programmeSlug(programme: string): string {
  return programme
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

export async function listSchedulesForLocation(
  env: Env,
  locationId: string
): Promise<ScheduleRow[]> {
  const { results } = await env.DB.prepare(
    `SELECT id, organization_id, location_id, programme, day_of_week, start_time, display_label, sort_order
     FROM location_programme_schedules
     WHERE organization_id = ? AND location_id = ?
     ORDER BY programme ASC, day_of_week ASC, sort_order ASC, start_time ASC`
  )
    .bind(env.ORGANIZATION_ID, locationId)
    .all<ScheduleRow>();
  return results ?? [];
}

export async function loadProgrammeSchedule(
  env: Env,
  locationId: string,
  programme: string
): Promise<ProgrammeSchedule | null> {
  const { results } = await env.DB.prepare(
    `SELECT id, organization_id, location_id, programme, day_of_week, start_time, display_label, sort_order
     FROM location_programme_schedules
     WHERE organization_id = ? AND location_id = ? AND programme = ?
     ORDER BY day_of_week ASC, sort_order ASC, start_time ASC`
  )
    .bind(env.ORGANIZATION_ID, locationId, programme)
    .all<ScheduleRow>();

  const slots = results ?? [];
  if (slots.length === 0) {
    const { results: fuzzyResults } = await env.DB.prepare(
      `SELECT id, organization_id, location_id, programme, day_of_week, start_time, display_label, sort_order
       FROM location_programme_schedules
       WHERE organization_id = ? AND location_id = ?
       ORDER BY programme ASC, day_of_week ASC, sort_order ASC`
    )
      .bind(env.ORGANIZATION_ID, locationId)
      .all<ScheduleRow>();

    const all = fuzzyResults ?? [];
    const match = pickProgrammeFromRows(programme, all);
    if (!match.length) return null;
    return {
      locationId,
      programme: match[0].programme,
      slots: match,
    };
  }

  return { locationId, programme, slots };
}

function pickProgrammeFromRows(
  interest: string,
  rows: ScheduleRow[]
): ScheduleRow[] {
  const lower = interest.toLowerCase();
  const programmes = [...new Set(rows.map((r) => r.programme))];
  let best = programmes[0];
  let bestScore = 0;
  for (const p of programmes) {
    const pl = p.toLowerCase();
    let score = 0;
    if (pl === lower) score = 100;
    else if (pl.includes(lower) || lower.includes(pl)) score = 50;
    if (lower.includes("mma") && pl.includes("mma")) score = 40;
    if (lower.includes("muay") && pl.includes("muay")) score = 40;
    if (lower.includes("bjj") && pl.includes("bjj")) score = 40;
    if (score > bestScore) {
      bestScore = score;
      best = p;
    }
  }
  return rows.filter((r) => r.programme === best);
}

export function uniqueTimesFromSlots(slots: ScheduleRow[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of slots) {
    if (!seen.has(s.display_label)) {
      seen.add(s.display_label);
      out.push(s.display_label);
    }
  }
  return out;
}

export function uniqueDaysFromSlots(slots: ScheduleRow[]): string[] {
  const days = new Set(slots.map((s) => s.day_of_week));
  return DAY_ORDER.filter((d) => days.has(d));
}

export function formatDaysPhrase(days: string[]): string {
  const labels: Record<string, string> = {
    mon: "Monday",
    tue: "Tuesday",
    wed: "Wednesday",
    thu: "Thursday",
    fri: "Friday",
    sat: "Saturday",
    sun: "Sunday",
  };
  const names = days.map((d) => labels[d] ?? d);
  if (names.length === 0) return "";
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

export function formatTimesPhrase(times: string[]): string {
  if (times.length === 0) return "";
  if (times.length === 1) return `at ${times[0]}`;
  const last = times[times.length - 1];
  const rest = times.slice(0, -1).join(", ");
  return `at ${rest} and ${last}`;
}

export function buildScheduleSummary(schedule: ProgrammeSchedule): string {
  const days = formatDaysPhrase(uniqueDaysFromSlots(schedule.slots));
  const times = formatTimesPhrase(uniqueTimesFromSlots(schedule.slots));
  if (!days && !times) return "through the week — we'll confirm times when you book";
  if (!days) return `with classes ${times}`;
  if (!times) return `on ${days}`;
  return `on ${days} ${times} (not every day)`;
}

export async function replaceProgrammeSchedule(
  env: Env,
  locationId: string,
  programme: string,
  slots: ProgrammeScheduleSlot[]
): Promise<void> {
  await env.DB.prepare(
    `DELETE FROM location_programme_schedules
     WHERE organization_id = ? AND location_id = ? AND programme = ?`
  )
    .bind(env.ORGANIZATION_ID, locationId, programme)
    .run();

  for (let i = 0; i < slots.length; i++) {
    const s = slots[i];
    const id = `sched-${locationId}-${programmeSlug(programme)}-${s.dayOfWeek}-${s.startTime.replace(":", "")}`;
    await env.DB.prepare(
      `INSERT INTO location_programme_schedules
        (id, organization_id, location_id, programme, day_of_week, start_time, display_label, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        id,
        env.ORGANIZATION_ID,
        locationId,
        programme,
        s.dayOfWeek,
        s.startTime,
        s.displayLabel,
        s.sortOrder ?? i
      )
      .run();
  }
}

export async function listProgrammesForLocation(
  env: Env,
  locationId: string
): Promise<string[]> {
  const { results } = await env.DB.prepare(
    `SELECT DISTINCT programme FROM location_programme_schedules
     WHERE organization_id = ? AND location_id = ?
     ORDER BY programme ASC`
  )
    .bind(env.ORGANIZATION_ID, locationId)
    .all<{ programme: string }>();
  return (results ?? []).map((r) => r.programme);
}
