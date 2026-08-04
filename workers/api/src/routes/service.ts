import {
  AvailabilityExceptionInputSchema,
  FloorPlanSchema,
  ServicePeriodInputSchema,
  VenueSettingsInputSchema,
} from "@lead-intake/shared-types";
import { jsonResponse } from "../cors";
import { canManageVenue } from "../auth/staff";
import { getStaffSession, type StaffSession } from "../auth/session";
import { getDefaultLocation } from "../db/locations";
import {
  createException,
  deleteException,
  listExceptions,
} from "../plugins/service/db/exceptions";
import {
  deleteServicePeriod,
  getServicePeriod,
  listServicePeriods,
  upsertServicePeriod,
} from "../plugins/service/db/periods";
import { getFloorPlan, saveFloorPlan } from "../plugins/service/db/tables";
import {
  getVenueSettings,
  upsertVenueSettings,
} from "../plugins/service/db/venue";
import { addDays, venueLocalDate } from "../plugins/service/time";
import type { Env } from "../env";

/**
 * Staff-facing service routes. The global gate in index.ts has already
 * established that a session exists; these handlers re-read it to apply role
 * checks. Reads need any session, writes need canManageVenue.
 *
 * Errors use the { error, code, details? } envelope from spec §14 so the
 * client can render a specific recovery rather than parsing prose.
 */

function serviceError(
  request: Request,
  env: Env,
  status: number,
  code: string,
  error: string,
  details?: unknown
): Response {
  return jsonResponse(
    request,
    env,
    details === undefined ? { error, code } : { error, code, details },
    status
  );
}

async function requireSession(
  request: Request,
  env: Env
): Promise<StaffSession | Response> {
  const session = await getStaffSession(env, request);
  if (!session) {
    return serviceError(request, env, 401, "UNAUTHORIZED", "Unauthorized");
  }
  return session;
}

async function requireVenueManager(
  request: Request,
  env: Env
): Promise<StaffSession | Response> {
  const session = await requireSession(request, env);
  if (session instanceof Response) return session;
  if (!canManageVenue(session.row.role)) {
    return serviceError(
      request,
      env,
      403,
      "FORBIDDEN",
      "You need an admin role to change venue configuration"
    );
  }
  return session;
}

/**
 * One venue per deployment today, so the location is resolved from the org
 * unless the caller names one. The schema is already multi-venue.
 */
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

async function readJson(request: Request): Promise<unknown | typeof INVALID> {
  try {
    return await request.json();
  } catch {
    return INVALID;
  }
}
const INVALID = Symbol("invalid-json");

// ── /service/settings ────────────────────────────────────────────────────────

export async function handleGetServiceSettings(
  request: Request,
  env: Env
): Promise<Response> {
  const session = await requireSession(request, env);
  if (session instanceof Response) return session;

  const locationId = await resolveLocationId(request, env);
  if (!locationId) {
    return serviceError(
      request,
      env,
      404,
      "NO_LOCATION",
      "This deployment has no location configured"
    );
  }

  return jsonResponse(request, env, {
    settings: await getVenueSettings(env, locationId),
  });
}

export async function handlePutServiceSettings(
  request: Request,
  env: Env
): Promise<Response> {
  const session = await requireVenueManager(request, env);
  if (session instanceof Response) return session;

  const locationId = await resolveLocationId(request, env);
  if (!locationId) {
    return serviceError(
      request,
      env,
      404,
      "NO_LOCATION",
      "This deployment has no location configured"
    );
  }

  const body = await readJson(request);
  if (body === INVALID) {
    return serviceError(request, env, 400, "INVALID_JSON", "Invalid JSON");
  }

  const parsed = VenueSettingsInputSchema.safeParse(body);
  if (!parsed.success) {
    return serviceError(
      request,
      env,
      400,
      "INVALID_SETTINGS",
      "Venue settings failed validation",
      parsed.error.issues
    );
  }

  const settings = await upsertVenueSettings(env, locationId, parsed.data);
  return jsonResponse(request, env, { settings });
}

// ── /service/floor-plan ──────────────────────────────────────────────────────

export async function handleGetFloorPlan(
  request: Request,
  env: Env
): Promise<Response> {
  const session = await requireSession(request, env);
  if (session instanceof Response) return session;

  const locationId = await resolveLocationId(request, env);
  if (!locationId) {
    return serviceError(
      request,
      env,
      404,
      "NO_LOCATION",
      "This deployment has no location configured"
    );
  }

  return jsonResponse(request, env, await getFloorPlan(env, locationId));
}

export async function handlePutFloorPlan(
  request: Request,
  env: Env
): Promise<Response> {
  const session = await requireVenueManager(request, env);
  if (session instanceof Response) return session;

  const locationId = await resolveLocationId(request, env);
  if (!locationId) {
    return serviceError(
      request,
      env,
      404,
      "NO_LOCATION",
      "This deployment has no location configured"
    );
  }

  const body = await readJson(request);
  if (body === INVALID) {
    return serviceError(request, env, 400, "INVALID_JSON", "Invalid JSON");
  }

  const parsed = FloorPlanSchema.safeParse(body);
  if (!parsed.success) {
    return serviceError(
      request,
      env,
      400,
      "INVALID_FLOOR_PLAN",
      "Floor plan failed validation",
      parsed.error.issues
    );
  }

  const result = await saveFloorPlan(env, locationId, parsed.data);
  if (!result.ok) {
    return serviceError(
      request,
      env,
      400,
      "INVALID_FLOOR_PLAN",
      "Floor plan failed validation",
      result.issues
    );
  }

  return jsonResponse(request, env, result.plan);
}

// ── /service/periods ─────────────────────────────────────────────────────────

export async function handleGetServicePeriods(
  request: Request,
  env: Env
): Promise<Response> {
  const session = await requireSession(request, env);
  if (session instanceof Response) return session;

  const locationId = await resolveLocationId(request, env);
  if (!locationId) {
    return serviceError(
      request,
      env,
      404,
      "NO_LOCATION",
      "This deployment has no location configured"
    );
  }

  return jsonResponse(request, env, await listServicePeriods(env, locationId));
}

export async function handleCreateServicePeriod(
  request: Request,
  env: Env
): Promise<Response> {
  const session = await requireVenueManager(request, env);
  if (session instanceof Response) return session;

  const locationId = await resolveLocationId(request, env);
  if (!locationId) {
    return serviceError(
      request,
      env,
      404,
      "NO_LOCATION",
      "This deployment has no location configured"
    );
  }

  const body = await readJson(request);
  if (body === INVALID) {
    return serviceError(request, env, 400, "INVALID_JSON", "Invalid JSON");
  }

  const parsed = ServicePeriodInputSchema.safeParse(body);
  if (!parsed.success) {
    return serviceError(
      request,
      env,
      400,
      "INVALID_PERIOD",
      "Service period failed validation",
      parsed.error.issues
    );
  }

  const period = await upsertServicePeriod(
    env,
    locationId,
    crypto.randomUUID(),
    parsed.data
  );
  return jsonResponse(request, env, { period }, 201);
}

export async function handlePatchServicePeriod(
  request: Request,
  env: Env,
  periodId: string
): Promise<Response> {
  const session = await requireVenueManager(request, env);
  if (session instanceof Response) return session;

  const existing = await getServicePeriod(env, periodId);
  if (!existing) {
    return serviceError(
      request,
      env,
      404,
      "PERIOD_NOT_FOUND",
      "Service period not found"
    );
  }

  const body = await readJson(request);
  if (body === INVALID) {
    return serviceError(request, env, 400, "INVALID_JSON", "Invalid JSON");
  }

  const parsed = ServicePeriodInputSchema.safeParse(body);
  if (!parsed.success) {
    return serviceError(
      request,
      env,
      400,
      "INVALID_PERIOD",
      "Service period failed validation",
      parsed.error.issues
    );
  }

  const period = await upsertServicePeriod(
    env,
    existing.location_id,
    periodId,
    parsed.data
  );
  return jsonResponse(request, env, { period });
}

export async function handleDeleteServicePeriod(
  request: Request,
  env: Env,
  periodId: string
): Promise<Response> {
  const session = await requireVenueManager(request, env);
  if (session instanceof Response) return session;

  const existing = await getServicePeriod(env, periodId);
  if (!existing) {
    return serviceError(
      request,
      env,
      404,
      "PERIOD_NOT_FOUND",
      "Service period not found"
    );
  }

  await deleteServicePeriod(env, periodId);
  return jsonResponse(request, env, { ok: true });
}

// ── /service/exceptions ──────────────────────────────────────────────────────

export async function handleGetExceptions(
  request: Request,
  env: Env
): Promise<Response> {
  const session = await requireSession(request, env);
  if (session instanceof Response) return session;

  const locationId = await resolveLocationId(request, env);
  if (!locationId) {
    return serviceError(
      request,
      env,
      404,
      "NO_LOCATION",
      "This deployment has no location configured"
    );
  }

  const params = new URL(request.url).searchParams;
  const settings = await getVenueSettings(env, locationId);
  const today = venueLocalDate(new Date(), settings.timezone);
  const from = params.get("from") ?? today;
  const to = params.get("to") ?? addDays(from, 90);

  return jsonResponse(request, env, {
    exceptions: await listExceptions(env, locationId, from, to),
  });
}

export async function handleCreateException(
  request: Request,
  env: Env
): Promise<Response> {
  const session = await requireVenueManager(request, env);
  if (session instanceof Response) return session;

  const locationId = await resolveLocationId(request, env);
  if (!locationId) {
    return serviceError(
      request,
      env,
      404,
      "NO_LOCATION",
      "This deployment has no location configured"
    );
  }

  const body = await readJson(request);
  if (body === INVALID) {
    return serviceError(request, env, 400, "INVALID_JSON", "Invalid JSON");
  }

  const parsed = AvailabilityExceptionInputSchema.safeParse(body);
  if (!parsed.success) {
    return serviceError(
      request,
      env,
      400,
      "INVALID_EXCEPTION",
      "Exception failed validation",
      parsed.error.issues
    );
  }

  const exception = await createException(
    env,
    locationId,
    parsed.data,
    session.row.id
  );
  return jsonResponse(request, env, { exception }, 201);
}

export async function handleDeleteException(
  request: Request,
  env: Env,
  exceptionId: string
): Promise<Response> {
  const session = await requireVenueManager(request, env);
  if (session instanceof Response) return session;

  const removed = await deleteException(env, exceptionId);
  if (!removed) {
    return serviceError(
      request,
      env,
      404,
      "EXCEPTION_NOT_FOUND",
      "Exception not found"
    );
  }

  return jsonResponse(request, env, { ok: true });
}
