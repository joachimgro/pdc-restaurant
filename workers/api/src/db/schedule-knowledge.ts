import type { KnowledgeChunk } from "@lead-intake/knowledge";
import type { Env } from "../env";
import {
  buildScheduleSummary,
  formatDaysPhrase,
  formatTimesPhrase,
  loadProgrammeSchedule,
  programmeSlug,
  uniqueDaysFromSlots,
  uniqueTimesFromSlots,
} from "./location-schedules";
import { upsertSingleChunk, deleteChunkVector } from "./knowledge-ingest";

async function getLocationNameFromDb(
  env: Env,
  locationId: string
): Promise<string> {
  const row = await env.DB.prepare(
    `SELECT name FROM locations WHERE id = ? AND organization_id = ?`
  )
    .bind(locationId, env.ORGANIZATION_ID)
    .first<{ name: string }>();
  return row?.name ?? locationId;
}

export function buildScheduleKnowledgeText(
  locationName: string,
  programme: string,
  summary: string,
  days: string[],
  times: string[]
): string {
  const daysText = formatDaysPhrase(days);
  const timesText = formatTimesPhrase(times);
  const slotNote =
    times.length > 1
      ? `There are ${times.length} separate class START times (${times.join(", ")}) — each is its own independent session, not a range. When booking a trial, ask which start time the lead wants.`
      : times.length === 1
        ? `The class starts at ${times[0]}. This is the start time, not an end time.`
        : "";
  return `${locationName} ${programme}: classes run ${daysText} ${timesText}. ${summary.replace(/^on /, "Schedule: ")} Classes are not held every day — only on the days listed. ${slotNote} When booking a free trial, confirm day and start time, then wait for the lead to say yes before marking booked.`;
}

export function scheduleChunkId(locationId: string, programme: string): string {
  return `schedule-${locationId}-${programmeSlug(programme)}`;
}

export async function syncScheduleKnowledge(
  env: Env,
  locationId: string,
  programme: string
): Promise<void> {
  const schedule = await loadProgrammeSchedule(env, locationId, programme);
  const chunkId = scheduleChunkId(locationId, programme);
  const locationName = await getLocationNameFromDb(env, locationId);

  if (!schedule || schedule.slots.length === 0) {
    await env.DB.prepare(
      `DELETE FROM knowledge_chunks WHERE id = ? AND organization_id = ?`
    )
      .bind(chunkId, env.ORGANIZATION_ID)
      .run();
    await deleteChunkVector(env, chunkId);
    return;
  }

  const summary = buildScheduleSummary(schedule);
  const text = buildScheduleKnowledgeText(
    locationName,
    programme,
    summary,
    uniqueDaysFromSlots(schedule.slots),
    uniqueTimesFromSlots(schedule.slots)
  );

  const existing = await env.DB.prepare(
    `SELECT id FROM knowledge_chunks WHERE id = ?`
  )
    .bind(chunkId)
    .first();

  let chunk: KnowledgeChunk;
  if (existing) {
    await env.DB.prepare(
      `UPDATE knowledge_chunks SET title = ?, text = ?, location_id = ?, source = 'schedule', updated_at = datetime('now')
       WHERE id = ?`
    )
      .bind(
        `${locationName} — ${programme} schedule`,
        text,
        locationId,
        chunkId
      )
      .run();
    chunk = {
      id: chunkId,
      organizationId: env.ORGANIZATION_ID,
      locationId,
      title: `${locationName} — ${programme} schedule`,
      source: "schedule",
      text,
    };
  } else {
    await env.DB.prepare(
      `INSERT INTO knowledge_chunks (id, organization_id, location_id, title, source, text)
       VALUES (?, ?, ?, ?, 'schedule', ?)`
    )
      .bind(
        chunkId,
        env.ORGANIZATION_ID,
        locationId,
        `${locationName} — ${programme} schedule`,
        text
      )
      .run();
    chunk = {
      id: chunkId,
      organizationId: env.ORGANIZATION_ID,
      locationId,
      title: `${locationName} — ${programme} schedule`,
      source: "schedule",
      text,
    };
  }

  if (env.KNOWLEDGE && env.AI) {
    await upsertSingleChunk(env, chunk);
  }
}

export async function syncAllSchedulesForLocation(
  env: Env,
  locationId: string
): Promise<void> {
  const { results } = await env.DB.prepare(
    `SELECT DISTINCT programme FROM location_programme_schedules
     WHERE organization_id = ? AND location_id = ?`
  )
    .bind(env.ORGANIZATION_ID, locationId)
    .all<{ programme: string }>();

  for (const row of results ?? []) {
    await syncScheduleKnowledge(env, locationId, row.programme);
  }
}
