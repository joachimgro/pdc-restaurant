import { jsonResponse } from "../cors";
import { deleteAllLeadsAndData } from "../db/reset";
import { getOrgLocations } from "../db/locations";
import { seedDatabase } from "../db/seed";
import { syncAllSchedulesForLocation } from "../db/schedule-knowledge";
import type { Env } from "../env";

const RESET_CONFIRM = "DELETE ALL LEADS";

export async function handleAdminResetAll(
  request: Request,
  env: Env
): Promise<Response> {
  let body: { confirm?: string };
  try {
    body = (await request.json()) as { confirm?: string };
  } catch {
    return jsonResponse(request, env, { error: "Invalid JSON" }, 400);
  }

  if (body.confirm !== RESET_CONFIRM) {
    return jsonResponse(
      request,
      env,
      {
        error: `Confirmation required. Send { "confirm": "${RESET_CONFIRM}" }`,
      },
      400
    );
  }

  const { leadsDeleted } = await deleteAllLeadsAndData(env);

  return jsonResponse(request, env, {
    ok: true,
    leadsDeleted,
    message: `Removed ${leadsDeleted} lead(s) and all messages, timelines, and events.`,
  });
}

export async function handleAdminSeed(
  request: Request,
  env: Env
): Promise<Response> {
  const result = await seedDatabase(env);

  const locations = await getOrgLocations(env);
  if (locations.length === 0) {
    console.warn(
      `No locations configured for org ${env.ORGANIZATION_ID} — skipping schedule sync.`
    );
  } else {
    for (const loc of locations) {
      try {
        await syncAllSchedulesForLocation(env, loc.id);
      } catch (e) {
        console.warn(`Schedule knowledge sync for ${loc.id}`, e);
      }
    }
  }

  return jsonResponse(request, env, result);
}
