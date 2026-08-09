import { jsonResponse } from "../cors";
import { getDefaultLocation } from "../db/locations";
import { getStaffSession } from "../auth/session";
import { queryServiceStats } from "../plugins/service/db/stats";
import { addDays, venueLocalDate } from "../plugins/service/time";
import { getVenueSettings } from "../plugins/service/db/venue";
import type { Env } from "../env";

function serviceError(
  request: Request,
  env: Env,
  status: number,
  code: string,
  error: string
): Response {
  return jsonResponse(request, env, { error, code }, status);
}

async function resolveLocationId(
  request: Request,
  env: Env
): Promise<string | null> {
  const explicit = new URL(request.url).searchParams.get("locationId");
  if (explicit) {
    const row = await env.DB.prepare(
      `SELECT id FROM locations WHERE id = ? AND organization_id = ?`
    )
      .bind(explicit, env.ORGANIZATION_ID)
      .first<{ id: string }>();
    return row?.id ?? null;
  }
  const location = await getDefaultLocation(env);
  return location?.id ?? null;
}

/** GET /service/stats?from=YYYY-MM-DD&to=YYYY-MM-DD&locationId= */
export async function handleGetServiceStats(
  request: Request,
  env: Env
): Promise<Response> {
  const session = await getStaffSession(env, request);
  if (!session) {
    return serviceError(request, env, 401, "UNAUTHORIZED", "Unauthorized");
  }

  const locationId = await resolveLocationId(request, env);
  if (!locationId) {
    return serviceError(request, env, 404, "NO_LOCATION", "No location configured");
  }

  const settings = await getVenueSettings(env, locationId);
  if (!settings) {
    return serviceError(request, env, 404, "NO_SETTINGS", "Venue is not configured");
  }

  const url = new URL(request.url);
  const today = venueLocalDate(new Date(), settings.timezone);
  const from = url.searchParams.get("from") ?? addDays(today, -27);
  const to = url.searchParams.get("to") ?? today;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return serviceError(
      request,
      env,
      400,
      "INVALID_DATE",
      "from and to must be YYYY-MM-DD"
    );
  }

  if (from > to) {
    return serviceError(
      request,
      env,
      400,
      "INVALID_RANGE",
      "from must be on or before to"
    );
  }

  const stats = await queryServiceStats(env, locationId, from, to);
  return jsonResponse(request, env, stats);
}
