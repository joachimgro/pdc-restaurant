import { z } from "zod";
import { waitlistEnabled } from "../capabilities";
import { jsonResponse } from "../cors";
import { getStaffSession, type StaffSession } from "../auth/session";
import { domainEventStatement } from "../db/events";
import { getDefaultLocation } from "../db/locations";
import type { Env } from "../env";
import {
  checkBookingRateLimit,
  clientIp,
} from "../lib/booking-rate-limit";
import { verifyTurnstile } from "../lib/turnstile";
import { resolveGuest } from "../plugins/service/guests";
import { generateReference } from "../plugins/service/reference";
import { getReservation } from "../plugins/service/db/reservations";
import {
  createEntry,
  convertToReservation,
  getEntry,
  listForDate,
  notifyEntry,
  removeEntry,
  serializeWaitlistEntry,
} from "../plugins/service/db/waitlist";
import {
  findLocationByBookingSlug,
  getVenueSettings,
} from "../plugins/service/db/venue";
import { localToUtcIso } from "../plugins/service/time";

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

function waitlistDisabled(request: Request, env: Env): Response {
  return serviceError(request, env, 404, "NOT_FOUND", "Not found");
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
  return (await getDefaultLocation(env))?.id ?? null;
}

const INVALID = Symbol("invalid-json");

async function readJson(request: Request): Promise<unknown | typeof INVALID> {
  try {
    return await request.json();
  } catch {
    return INVALID;
  }
}

function addMinutesToTime(hhmm: string, minutes: number): string {
  const [h, m] = hhmm.split(":").map(Number);
  const total = h * 60 + m + minutes;
  const nh = Math.floor(total / 60) % 24;
  const nm = total % 60;
  return `${String(nh).padStart(2, "0")}:${String(nm).padStart(2, "0")}`;
}

async function createMinimalReservation(
  env: Env,
  entry: NonNullable<Awaited<ReturnType<typeof getEntry>>>,
  staffUserId: string | null
): Promise<string> {
  const settings = await getVenueSettings(env, entry.location_id);
  const startTime = entry.requested_from ?? "18:00";
  const endTime =
    entry.requested_to ??
    addMinutesToTime(startTime, settings?.defaultTurnMinutes ?? 90);

  const { contactId } = await resolveGuest(env, {
    name: entry.guest_name,
    email: entry.guest_email,
    phone: entry.guest_phone,
  });

  const reservationId = crypto.randomUUID();
  const startsAtUtc = localToUtcIso(
    entry.service_date,
    startTime,
    settings?.timezone ?? "Europe/London"
  );

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO reservations (
         id, organization_id, location_id, reference, contact_id, guest_name,
         guest_phone, guest_email, party_size, service_date, start_time, end_time,
         starts_at_utc, status, source, created_by_staff_id
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', 'waitlist', ?)`
    ).bind(
      reservationId,
      env.ORGANIZATION_ID,
      entry.location_id,
      generateReference(),
      contactId,
      entry.guest_name,
      entry.guest_phone,
      entry.guest_email,
      entry.party_size,
      entry.service_date,
      startTime,
      endTime,
      startsAtUtc,
      staffUserId
    ),
    domainEventStatement(env.DB, env.ORGANIZATION_ID, {
      type: "waitlist.converted",
      payload: {
        waitlistEntryId: entry.id,
        reservationId,
        locationId: entry.location_id,
        serviceDate: entry.service_date,
      },
    }).statement,
  ]);

  return reservationId;
}

/** GET /service/waitlist?date=&locationId= */
export async function handleListWaitlist(
  request: Request,
  env: Env
): Promise<Response> {
  if (!waitlistEnabled(env)) return waitlistDisabled(request, env);

  const session = await requireSession(request, env);
  if (session instanceof Response) return session;

  const locationId = await resolveLocationId(request, env);
  if (!locationId) {
    return serviceError(request, env, 404, "NO_LOCATION", "No location configured");
  }

  const url = new URL(request.url);
  const serviceDate =
    url.searchParams.get("date") ?? new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(serviceDate)) {
    return serviceError(request, env, 400, "INVALID_DATE", "date must be YYYY-MM-DD");
  }

  const entries = await listForDate(env, locationId, serviceDate);
  return jsonResponse(request, env, {
    serviceDate,
    locationId,
    entries: entries.map((e) => serializeWaitlistEntry(e, e.position)),
  });
}

const CreateWaitlistSchema = z.object({
  guestName: z.string().trim().min(1).max(120),
  guestPhone: z.string().trim().max(40).optional().nullable(),
  guestEmail: z.string().trim().email().max(200).optional().nullable(),
  partySize: z.number().int().min(1).max(30),
  kind: z.enum(["walk_in", "date_waitlist"]).default("walk_in"),
  serviceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  requestedFrom: z.string().regex(/^\d{2}:\d{2}$/).optional().nullable(),
  requestedTo: z.string().regex(/^\d{2}:\d{2}$/).optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
  locationId: z.string().optional(),
});

/** POST /service/waitlist — staff walk-in add */
export async function handleCreateWaitlist(
  request: Request,
  env: Env
): Promise<Response> {
  if (!waitlistEnabled(env)) return waitlistDisabled(request, env);

  const session = await requireSession(request, env);
  if (session instanceof Response) return session;

  const body = await readJson(request);
  if (body === INVALID) {
    return serviceError(request, env, 400, "INVALID_JSON", "Invalid JSON");
  }

  const parsed = CreateWaitlistSchema.safeParse(body);
  if (!parsed.success) {
    return serviceError(
      request,
      env,
      400,
      "VALIDATION",
      "Invalid waitlist payload",
      parsed.error.flatten()
    );
  }

  const locationId =
    parsed.data.locationId ?? (await resolveLocationId(request, env));
  if (!locationId) {
    return serviceError(request, env, 404, "NO_LOCATION", "No location configured");
  }

  const entry = await createEntry(env, {
    locationId,
    guestName: parsed.data.guestName,
    guestPhone: parsed.data.guestPhone,
    guestEmail: parsed.data.guestEmail,
    partySize: parsed.data.partySize,
    kind: parsed.data.kind,
    serviceDate: parsed.data.serviceDate,
    requestedFrom: parsed.data.requestedFrom,
    requestedTo: parsed.data.requestedTo,
    notes: parsed.data.notes,
    createdByStaffId: session.row.id,
  });

  await domainEventStatement(env.DB, env.ORGANIZATION_ID, {
    type: "waitlist.joined",
    payload: {
      waitlistEntryId: entry.id,
      locationId,
      serviceDate: entry.service_date,
      kind: entry.kind,
    },
  }).statement.run();

  const queue = await listForDate(env, locationId, entry.service_date);
  const position = queue.find((e) => e.id === entry.id)?.position ?? queue.length;

  return jsonResponse(
    request,
    env,
    { entry: serializeWaitlistEntry(entry, position) },
    201
  );
}

/** POST /service/waitlist/:id/notify */
export async function handleNotifyWaitlist(
  request: Request,
  env: Env,
  id: string
): Promise<Response> {
  if (!waitlistEnabled(env)) return waitlistDisabled(request, env);

  const session = await requireSession(request, env);
  if (session instanceof Response) return session;

  const updated = await notifyEntry(env, id);
  if (!updated) {
    return serviceError(request, env, 404, "NOT_FOUND", "Waitlist entry not found");
  }

  await domainEventStatement(env.DB, env.ORGANIZATION_ID, {
    type: "waitlist.notified",
    payload: {
      waitlistEntryId: id,
      locationId: updated.location_id,
      serviceDate: updated.service_date,
    },
  }).statement.run();

  const queue = await listForDate(env, updated.location_id, updated.service_date);
  const position = queue.find((e) => e.id === id)?.position;

  return jsonResponse(request, env, {
    entry: serializeWaitlistEntry(updated, position),
  });
}

const ConvertWaitlistSchema = z.object({
  reservationId: z.string().uuid().optional(),
});

/** POST /service/waitlist/:id/convert */
export async function handleConvertWaitlist(
  request: Request,
  env: Env,
  id: string
): Promise<Response> {
  if (!waitlistEnabled(env)) return waitlistDisabled(request, env);

  const session = await requireSession(request, env);
  if (session instanceof Response) return session;

  const body = await readJson(request);
  if (body === INVALID) {
    return serviceError(request, env, 400, "INVALID_JSON", "Invalid JSON");
  }

  const parsed = ConvertWaitlistSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return serviceError(
      request,
      env,
      400,
      "VALIDATION",
      "Invalid convert payload",
      parsed.error.flatten()
    );
  }

  const existing = await getEntry(env, id);
  if (!existing || existing.status === "removed" || existing.status === "converted") {
    return serviceError(request, env, 404, "NOT_FOUND", "Waitlist entry not found");
  }

  let reservationId = parsed.data.reservationId;
  if (reservationId) {
    const reservation = await getReservation(env, reservationId);
    if (!reservation) {
      return serviceError(request, env, 404, "NOT_FOUND", "Reservation not found");
    }
  } else {
    reservationId = await createMinimalReservation(env, existing, session.row.id);
  }

  const updated = await convertToReservation(env, id, reservationId);
  if (!updated) {
    return serviceError(request, env, 409, "CONFLICT", "Could not convert entry");
  }

  const reservation = await getReservation(env, reservationId);
  return jsonResponse(request, env, {
    entry: serializeWaitlistEntry(updated),
    reservation,
  });
}

const RemoveWaitlistSchema = z.object({
  reason: z.string().trim().max(500).optional(),
});

/** POST /service/waitlist/:id/remove */
export async function handleRemoveWaitlist(
  request: Request,
  env: Env,
  id: string
): Promise<Response> {
  if (!waitlistEnabled(env)) return waitlistDisabled(request, env);

  const session = await requireSession(request, env);
  if (session instanceof Response) return session;

  const body = await readJson(request);
  if (body === INVALID) {
    return serviceError(request, env, 400, "INVALID_JSON", "Invalid JSON");
  }

  const parsed = RemoveWaitlistSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return serviceError(
      request,
      env,
      400,
      "VALIDATION",
      "Invalid remove payload",
      parsed.error.flatten()
    );
  }

  const updated = await removeEntry(env, id, parsed.data.reason ?? "");
  if (!updated) {
    return serviceError(request, env, 404, "NOT_FOUND", "Waitlist entry not found");
  }

  return jsonResponse(request, env, {
    entry: serializeWaitlistEntry(updated),
  });
}

const BookWaitlistSchema = z.object({
  guestName: z.string().trim().min(1).max(120),
  partySize: z.number().int().min(1).max(30),
  guestEmail: z.string().trim().email().max(200).optional().nullable(),
  guestPhone: z.string().trim().max(40).optional().nullable(),
  serviceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  kind: z.enum(["date_waitlist", "walk_in"]).default("date_waitlist"),
  requestedFrom: z.string().regex(/^\d{2}:\d{2}$/).optional().nullable(),
  requestedTo: z.string().regex(/^\d{2}:\d{2}$/).optional().nullable(),
  turnstileToken: z.string().optional(),
});

/** POST /book/:slug/waitlist */
export async function handleBookWaitlist(
  request: Request,
  env: Env,
  slug: string
): Promise<Response> {
  if (!waitlistEnabled(env)) {
    return jsonResponse(request, env, { error: "Not found", code: "NOT_FOUND" }, 404);
  }

  const locationId = await findLocationByBookingSlug(env, slug);
  if (!locationId) {
    return jsonResponse(request, env, { error: "Venue not found", code: "NOT_FOUND" }, 404);
  }

  const settings = await getVenueSettings(env, locationId);
  if (!settings.bookingSlug || !settings.allowOnlineWaitlist) {
    return jsonResponse(
      request,
      env,
      { error: "Waitlist not available", code: "WAITLIST_DISABLED" },
      403
    );
  }

  const ip = clientIp(request);
  const limited = await checkBookingRateLimit(env, "waitlist", ip);
  if (!limited.ok) {
    return jsonResponse(
      request,
      env,
      { error: "Too many requests", code: "RATE_LIMITED" },
      429
    );
  }

  const body = await readJson(request);
  if (body === INVALID) {
    return jsonResponse(request, env, { error: "Invalid JSON", code: "INVALID_JSON" }, 400);
  }

  const parsed = BookWaitlistSchema.safeParse(body);
  if (!parsed.success) {
    return jsonResponse(
      request,
      env,
      {
        error: "Invalid waitlist payload",
        code: "VALIDATION",
        details: parsed.error.flatten(),
      },
      400
    );
  }

  if (
    parsed.data.partySize > settings.maxPartyOnline ||
    parsed.data.partySize < settings.minPartyOnline
  ) {
    return jsonResponse(
      request,
      env,
      { error: "Party size not accepted online", code: "PARTY_OUT_OF_RANGE" },
      400
    );
  }

  if (!parsed.data.guestEmail && !parsed.data.guestPhone) {
    return jsonResponse(
      request,
      env,
      { error: "Email or phone required", code: "CONTACT_REQUIRED" },
      400
    );
  }

  const turnstile = await verifyTurnstile(env, parsed.data.turnstileToken, ip);
  if (!turnstile.ok) {
    return jsonResponse(
      request,
      env,
      { error: turnstile.error, code: turnstile.code },
      403
    );
  }

  const entry = await createEntry(env, {
    locationId,
    guestName: parsed.data.guestName,
    guestEmail: parsed.data.guestEmail,
    guestPhone: parsed.data.guestPhone,
    partySize: parsed.data.partySize,
    kind: parsed.data.kind,
    serviceDate: parsed.data.serviceDate,
    requestedFrom: parsed.data.requestedFrom,
    requestedTo: parsed.data.requestedTo,
  });

  await domainEventStatement(env.DB, env.ORGANIZATION_ID, {
    type: "waitlist.joined",
    payload: {
      waitlistEntryId: entry.id,
      locationId,
      serviceDate: entry.service_date,
      kind: entry.kind,
      source: "online",
    },
  }).statement.run();

  const queue = await listForDate(env, locationId, entry.service_date);
  const position = queue.find((e) => e.id === entry.id)?.position ?? queue.length;

  return jsonResponse(
    request,
    env,
    {
      entry: serializeWaitlistEntry(entry, position),
      message:
        "You're on the waitlist — this is not a confirmed booking. We'll be in touch if a table opens up.",
    },
    201
  );
}
