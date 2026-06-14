import { jsonResponse } from "../cors";
import { getOrgLocations } from "../db/locations";
import { seedDatabase } from "../db/seed";
import { syncAllSchedulesForLocation } from "../db/schedule-knowledge";
import type { Env } from "../env";

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
