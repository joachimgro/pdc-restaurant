import { z } from "zod";
import { jsonResponse } from "../cors";
import {
  listProgrammesForLocation,
  listSchedulesForLocation,
  replaceProgrammeSchedule,
  type ProgrammeScheduleSlot,
} from "../db/location-schedules";
import {
  syncAllSchedulesForLocation,
  syncScheduleKnowledge,
} from "../db/schedule-knowledge";
import type { Env } from "../env";

const CreateLocationSchema = z.object({
  id: z
    .string()
    .min(2)
    .max(32)
    .regex(/^[a-z0-9-]+$/, "Use lowercase letters, numbers, hyphens"),
  name: z.string().min(2),
  abbrev: z.string().min(1).max(3),
});

const UpdateLocationSchema = z.object({
  name: z.string().min(2).optional(),
  abbrev: z.string().min(1).max(3).optional(),
});

const ScheduleSlotSchema = z.object({
  dayOfWeek: z.enum(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]),
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  displayLabel: z.string().min(2),
  sortOrder: z.number().int().optional(),
});

const PutSchedulesSchema = z.object({
  programme: z.string().min(1),
  slots: z.array(ScheduleSlotSchema),
});

export async function handleListAdminLocations(
  request: Request,
  env: Env
): Promise<Response> {
  const { results: locations } = await env.DB.prepare(
    `SELECT id, name, abbrev, badge_count FROM locations
     WHERE organization_id = ? ORDER BY name ASC`
  )
    .bind(env.ORGANIZATION_ID)
    .all<{ id: string; name: string; abbrev: string; badge_count: number | null }>();

  const out = [];
  for (const loc of locations ?? []) {
    const schedules = await listSchedulesForLocation(env, loc.id);
    const programmes = await listProgrammesForLocation(env, loc.id);
    const byProgramme: Record<
      string,
      Array<{
        id: string;
        dayOfWeek: string;
        startTime: string;
        displayLabel: string;
        sortOrder: number;
      }>
    > = {};
    for (const p of programmes) {
      byProgramme[p] = schedules
        .filter((s) => s.programme === p)
        .map((s) => ({
          id: s.id,
          dayOfWeek: s.day_of_week,
          startTime: s.start_time,
          displayLabel: s.display_label,
          sortOrder: s.sort_order,
        }));
    }
    out.push({ ...loc, programmes: byProgramme });
  }

  return jsonResponse(request, env, { locations: out });
}

export async function handleCreateLocation(
  request: Request,
  env: Env
): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse(request, env, { error: "Invalid JSON" }, 400);
  }
  const parsed = CreateLocationSchema.safeParse(body);
  if (!parsed.success) {
    return jsonResponse(
      request,
      env,
      { error: "Validation failed", issues: parsed.error.flatten() },
      400
    );
  }

  const existing = await env.DB.prepare(
    `SELECT 1 FROM locations WHERE id = ?`
  )
    .bind(parsed.data.id)
    .first();
  if (existing) {
    return jsonResponse(request, env, { error: "Location id already exists" }, 409);
  }

  await env.DB.prepare(
    `INSERT INTO locations (id, organization_id, name, abbrev, badge_count)
     VALUES (?, ?, ?, ?, 0)`
  )
    .bind(
      parsed.data.id,
      env.ORGANIZATION_ID,
      parsed.data.name,
      parsed.data.abbrev.toUpperCase()
    )
    .run();

  return jsonResponse(request, env, { ok: true, location: parsed.data });
}

export async function handleUpdateLocation(
  request: Request,
  env: Env,
  locationId: string
): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse(request, env, { error: "Invalid JSON" }, 400);
  }
  const parsed = UpdateLocationSchema.safeParse(body);
  if (!parsed.success) {
    return jsonResponse(request, env, { error: "Validation failed" }, 400);
  }

  const sets: string[] = [];
  const binds: unknown[] = [];
  if (parsed.data.name) {
    sets.push("name = ?");
    binds.push(parsed.data.name);
  }
  if (parsed.data.abbrev) {
    sets.push("abbrev = ?");
    binds.push(parsed.data.abbrev.toUpperCase());
  }
  if (!sets.length) {
    return jsonResponse(request, env, { error: "No fields to update" }, 400);
  }

  binds.push(locationId, env.ORGANIZATION_ID);
  await env.DB.prepare(
    `UPDATE locations SET ${sets.join(", ")} WHERE id = ? AND organization_id = ?`
  )
    .bind(...binds)
    .run();

  return jsonResponse(request, env, { ok: true });
}

export async function handlePutLocationSchedules(
  request: Request,
  env: Env,
  locationId: string
): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse(request, env, { error: "Invalid JSON" }, 400);
  }
  const parsed = PutSchedulesSchema.safeParse(body);
  if (!parsed.success) {
    return jsonResponse(
      request,
      env,
      { error: "Validation failed", issues: parsed.error.flatten() },
      400
    );
  }

  const loc = await env.DB.prepare(
    `SELECT id FROM locations WHERE id = ? AND organization_id = ?`
  )
    .bind(locationId, env.ORGANIZATION_ID)
    .first();
  if (!loc) {
    return jsonResponse(request, env, { error: "Location not found" }, 404);
  }

  await replaceProgrammeSchedule(
    env,
    locationId,
    parsed.data.programme,
    parsed.data.slots as ProgrammeScheduleSlot[]
  );
  await syncScheduleKnowledge(env, locationId, parsed.data.programme);

  return jsonResponse(request, env, {
    ok: true,
    message: "Schedule saved and synced to AI knowledge.",
    programme: parsed.data.programme,
    slotCount: parsed.data.slots.length,
  });
}

export async function handleSyncLocationSchedules(
  request: Request,
  env: Env,
  locationId: string
): Promise<Response> {
  await syncAllSchedulesForLocation(env, locationId);
  return jsonResponse(request, env, {
    ok: true,
    message: "All programmes at this location synced to knowledge index.",
  });
}
