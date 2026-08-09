import { GuestProfilePatchSchema } from "@lead-intake/shared-types";
import { z } from "zod";
import { jsonResponse } from "../cors";
import { getStaffSession, type StaffSession } from "../auth/session";
import { adminSecretAuthorized } from "../auth/admin-secret";
import type { Env } from "../env";
import { getReservation } from "../plugins/service/db/reservations";
import {
  findContactIdByEmail,
  getOrCreateProfile,
  patchGuestProfile,
} from "../plugins/service/db/guest-profiles";
import {
  eraseGuestByEmailOrPhone,
  exportGuestByEmailOrPhone,
} from "../plugins/service/db/guest-privacy";

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

/** Staff session or X-Admin-Secret (erase / SAR export). */
async function requireSessionOrAdmin(
  request: Request,
  env: Env
): Promise<StaffSession | { admin: true } | Response> {
  const session = await getStaffSession(env, request);
  if (session) return session;
  if (adminSecretAuthorized(request, env)) return { admin: true };
  return serviceError(request, env, 401, "UNAUTHORIZED", "Unauthorized");
}

async function readJson(request: Request): Promise<unknown | null> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

/** GET /service/guests/profile?email= */
export async function handleGetGuestProfileByEmail(
  request: Request,
  env: Env
): Promise<Response> {
  const session = await requireSession(request, env);
  if (session instanceof Response) return session;

  const email = new URL(request.url).searchParams.get("email")?.trim();
  if (!email) {
    return serviceError(request, env, 400, "EMAIL_REQUIRED", "email is required");
  }

  const contactId = await findContactIdByEmail(env, email);
  if (!contactId) {
    return serviceError(request, env, 404, "NOT_FOUND", "Guest not found");
  }

  const profile = await getOrCreateProfile(env, contactId);
  if (!profile) {
    return serviceError(request, env, 404, "NOT_FOUND", "Guest not found");
  }

  return jsonResponse(request, env, { profile });
}

/** PATCH /service/guests/:contactId */
export async function handlePatchGuestProfile(
  request: Request,
  env: Env,
  contactId: string
): Promise<Response> {
  const session = await requireSession(request, env);
  if (session instanceof Response) return session;

  const raw = await readJson(request);
  const parsed = GuestProfilePatchSchema.safeParse(raw);
  if (!parsed.success) {
    return serviceError(
      request,
      env,
      400,
      "INVALID_PROFILE",
      "Invalid guest profile patch",
      parsed.error.issues
    );
  }

  const patch = parsed.data;
  const profile = await patchGuestProfile(env, contactId, {
    vip: patch.vip,
    allergies: patch.allergies,
    dietary: patch.dietary,
    seatingPreference: patch.seatingPreference,
    notes: patch.notes,
    blocked: patch.blocked,
    blockedReason: patch.blockedReason,
  });

  if (!profile) {
    return serviceError(request, env, 404, "NOT_FOUND", "Guest not found");
  }

  return jsonResponse(request, env, { profile });
}

const ReservationProfilePatchSchema = GuestProfilePatchSchema.extend({
  vip: z.boolean().optional(),
});

/** PATCH /service/reservations/:id/guest-profile */
export async function handlePatchReservationGuestProfile(
  request: Request,
  env: Env,
  reservationId: string
): Promise<Response> {
  const session = await requireSession(request, env);
  if (session instanceof Response) return session;

  const reservation = await getReservation(env, reservationId);
  if (!reservation) {
    return serviceError(request, env, 404, "NOT_FOUND", "Reservation not found");
  }
  if (!reservation.contactId) {
    return serviceError(
      request,
      env,
      404,
      "NO_CONTACT",
      "This booking is not linked to a guest profile"
    );
  }

  const raw = await readJson(request);
  const parsed = ReservationProfilePatchSchema.safeParse(raw);
  if (!parsed.success) {
    return serviceError(
      request,
      env,
      400,
      "INVALID_PROFILE",
      "Invalid guest profile patch",
      parsed.error.issues
    );
  }

  const patch = parsed.data;
  const profile = await patchGuestProfile(env, reservation.contactId, {
    vip: patch.vip,
    allergies: patch.allergies,
    dietary: patch.dietary,
    seatingPreference: patch.seatingPreference,
    notes: patch.notes,
    blocked: patch.blocked,
    blockedReason: patch.blockedReason,
  });

  return jsonResponse(request, env, { profile });
}

const EraseGuestSchema = z
  .object({
    email: z.string().email().optional(),
    phone: z.string().min(5).optional(),
  })
  .refine((v) => Boolean(v.email || v.phone), {
    message: "email or phone required",
  });

/** POST /service/guests/erase — wipe PII by email or phone. */
export async function handleEraseGuest(
  request: Request,
  env: Env
): Promise<Response> {
  const auth = await requireSessionOrAdmin(request, env);
  if (auth instanceof Response) return auth;

  const raw = await readJson(request);
  const parsed = EraseGuestSchema.safeParse(raw);
  if (!parsed.success) {
    return serviceError(
      request,
      env,
      400,
      "INVALID_ERASE",
      "email or phone required",
      parsed.error.issues
    );
  }

  const result = await eraseGuestByEmailOrPhone(env, parsed.data);
  return jsonResponse(request, env, { ok: true, result });
}

/** GET /service/guests/export?email=&phone= — subject-access JSON. */
export async function handleExportGuest(
  request: Request,
  env: Env
): Promise<Response> {
  const auth = await requireSessionOrAdmin(request, env);
  if (auth instanceof Response) return auth;

  const url = new URL(request.url);
  const email = url.searchParams.get("email")?.trim() || undefined;
  const phone = url.searchParams.get("phone")?.trim() || undefined;
  if (!email && !phone) {
    return serviceError(
      request,
      env,
      400,
      "INVALID_EXPORT",
      "email or phone query required"
    );
  }

  const data = await exportGuestByEmailOrPhone(env, { email, phone });
  return jsonResponse(request, env, data);
}
