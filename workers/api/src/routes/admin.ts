import { jsonResponse } from "../cors";
import { kitchenEnabled } from "../capabilities";
import { getOrgLocations } from "../db/locations";
import { seedDatabase } from "../db/seed";
import { syncAllSchedulesForLocation } from "../db/schedule-knowledge";
import { seedKitchenMenu } from "../plugins/kitchen/seed";
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

  let kitchenMenuSeeded = false;
  if (kitchenEnabled(env) && locations.length > 0) {
    try {
      const menuResult = await seedKitchenMenu(env, locations[0].id);
      kitchenMenuSeeded = menuResult.seeded;
    } catch (e) {
      console.warn("Kitchen menu seed", e);
    }
  }

  return jsonResponse(request, env, { ...result, kitchenMenuSeeded });
}
