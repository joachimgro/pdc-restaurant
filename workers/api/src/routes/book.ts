import {
  BookCancelInputSchema,
  BookHoldInputSchema,
  BookModifyInputSchema,
  BookReserveInputSchema,
} from "@lead-intake/shared-types";
import { jsonResponse } from "../cors";
import { domainEventStatement } from "../db/events";
import type { Env } from "../env";
import {
  checkBookingRateLimit,
  clientIp,
} from "../lib/booking-rate-limit";
import { verifyTurnstile } from "../lib/turnstile";
import { guestBookingOrigin } from "../lib/venue-time";
import { dispatchDueNotifications } from "../notifications/dispatch";
import {
  cancelScheduledNotifications,
  scheduleBookingNotifications,
  scheduleNotification,
} from "../notifications/schedule";
import {
  loadAvailability,
  nearestAlternatives,
} from "../plugins/service/availability-loader";
import {
  consumeHold,
  createHold,
  holdTableIds,
} from "../plugins/service/holds";
import {
  mintGuestToken,
  resolveGuestToken,
  revokeGuestTokensForReservation,
} from "../plugins/service/guest-tokens";
import { resolveGuest } from "../plugins/service/guests";
import { generateReference } from "../plugins/service/reference";
import {
  getReservation,
  reservationEventStatement,
} from "../plugins/service/db/reservations";
import {
  findLocationByBookingSlug,
  getVenueSettings,
} from "../plugins/service/db/venue";
import {
  addDays,
  localToUtcIso,
  venueLocalDate,
} from "../plugins/service/time";

const INVALID = Symbol("invalid-json");

function bookError(
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

async function readJson(request: Request): Promise<unknown | typeof INVALID> {
  try {
    return await request.json();
  } catch {
    return INVALID;
  }
}

async function resolveSlug(
  request: Request,
  env: Env,
  slug: string
): Promise<
  | { locationId: string; settings: Awaited<ReturnType<typeof getVenueSettings>> }
  | Response
> {
  const locationId = await findLocationByBookingSlug(env, slug);
  if (!locationId) {
    return bookError(request, env, 404, "NOT_FOUND", "Venue not found");
  }
  const settings = await getVenueSettings(env, locationId);
  if (!settings.bookingSlug) {
    return bookError(request, env, 404, "NOT_FOUND", "Venue not found");
  }
  return { locationId, settings };
}

async function requireTurnstile(
  request: Request,
  env: Env,
  token: string | undefined
): Promise<Response | null> {
  const result = await verifyTurnstile(env, token, clientIp(request));
  if (!result.ok) {
    return bookError(request, env, 403, result.code, result.error);
  }
  return null;
}

function venueDisplayName(
  settings: Awaited<ReturnType<typeof getVenueSettings>>
): string {
  const brand = settings.brand;
  const brandName =
    brand && typeof brand["displayName"] === "string"
      ? (brand["displayName"] as string).trim()
      : brand && typeof brand["name"] === "string"
        ? (brand["name"] as string).trim()
        : "";
  if (brandName) return brandName;
  return settings.bookingSlug ?? "Restaurant";
}

function manageUrl(env: Env, rawToken: string): string {
  return `${guestBookingOrigin(env)}/manage/${rawToken}`;
}

async function roomForTables(
  env: Env,
  tableIds: string[]
): Promise<string | null> {
  if (tableIds.length === 0) return null;
  const row = await env.DB.prepare(
    `SELECT room_id FROM dining_tables WHERE id = ? AND organization_id = ?`
  )
    .bind(tableIds[0], env.ORGANIZATION_ID)
    .first<{ room_id: string }>();
  return row?.room_id ?? null;
}

async function notifyContextFromReservation(
  env: Env,
  locationId: string,
  reservationId: string,
  rawManageToken: string,
  settings: Awaited<ReturnType<typeof getVenueSettings>>
) {
  const reservation = await getReservation(env, reservationId);
  if (!reservation) throw new Error("reservation missing after write");
  return {
    locationId,
    reservationId,
    guestName: reservation.guestName,
    guestEmail: reservation.guestEmail,
    guestPhone: reservation.guestPhone,
    reference: reservation.reference,
    serviceDate: reservation.serviceDate,
    startTime: reservation.startTime,
    partySize: reservation.partySize,
    startsAtUtc: reservation.startsAtUtc,
    manageUrl: manageUrl(env, rawManageToken),
    venueName: venueDisplayName(settings),
    timezone: settings.timezone,
    addressText: settings.addressText,
    contactPhone: settings.contactPhone,
    brand: settings.brand,
  };
}

// ── GET /book/:slug/venue ────────────────────────────────────────────────────

export async function handleBookVenue(
  request: Request,
  env: Env,
  slug: string
): Promise<Response> {
  const resolved = await resolveSlug(request, env, slug);
  if (resolved instanceof Response) return resolved;
  const { settings } = resolved;

  return jsonResponse(request, env, {
    slug: settings.bookingSlug,
    name: venueDisplayName(settings),
    timezone: settings.timezone,
    minParty: settings.minPartyOnline,
    maxParty: settings.maxPartyOnline,
    largePartyMessage: settings.largePartyMessage,
    minLeadMinutes: settings.minLeadMinutes,
    maxAdvanceDays: settings.maxAdvanceDays,
    contactPhone: settings.contactPhone,
    contactEmail: settings.contactEmail,
    addressText: settings.addressText,
    brand: settings.brand,
    holdTtlSeconds: settings.holdTtlSeconds,
  });
}

// ── GET /book/:slug/days ─────────────────────────────────────────────────────

export async function handleBookDays(
  request: Request,
  env: Env,
  slug: string
): Promise<Response> {
  const resolved = await resolveSlug(request, env, slug);
  if (resolved instanceof Response) return resolved;
  const { locationId, settings } = resolved;

  const ip = clientIp(request);
  const limited = await checkBookingRateLimit(env, "avail", ip);
  if (!limited.ok) {
    return bookError(request, env, 429, "RATE_LIMITED", "Too many requests");
  }

  const url = new URL(request.url);
  const partySize = Number(url.searchParams.get("party") ?? "2");
  if (!Number.isInteger(partySize) || partySize < 1) {
    return bookError(request, env, 400, "INVALID_PARTY", "Invalid party size");
  }

  const now = new Date();
  const from =
    url.searchParams.get("from") ?? venueLocalDate(now, settings.timezone);
  const to =
    url.searchParams.get("to") ??
    addDays(from, Math.min(settings.maxAdvanceDays, 14));

  const days: Array<{
    date: string;
    available: boolean;
    slotCount: number;
  }> = [];

  let cursor = from;
  while (cursor <= to) {
    const loaded = await loadAvailability(env, locationId, {
      serviceDate: cursor,
      partySize,
      channel: "online",
      now,
    });
    const availableSlots =
      loaded?.slots.filter((s) => s.available).length ?? 0;
    days.push({
      date: cursor,
      available: availableSlots > 0,
      slotCount: availableSlots,
    });
    cursor = addDays(cursor, 1);
  }

  return jsonResponse(request, env, { from, to, partySize, days });
}

// ── GET /book/:slug/availability ─────────────────────────────────────────────

export async function handleBookAvailability(
  request: Request,
  env: Env,
  slug: string
): Promise<Response> {
  const resolved = await resolveSlug(request, env, slug);
  if (resolved instanceof Response) return resolved;
  const { locationId, settings } = resolved;

  const ip = clientIp(request);
  const limited = await checkBookingRateLimit(env, "avail", ip);
  if (!limited.ok) {
    return bookError(request, env, 429, "RATE_LIMITED", "Too many requests");
  }

  const url = new URL(request.url);
  const serviceDate = url.searchParams.get("date");
  const partySize = Number(url.searchParams.get("party") ?? "2");
  if (!serviceDate || !/^\d{4}-\d{2}-\d{2}$/.test(serviceDate)) {
    return bookError(request, env, 400, "INVALID_DATE", "date must be YYYY-MM-DD");
  }
  if (!Number.isInteger(partySize) || partySize < 1) {
    return bookError(request, env, 400, "INVALID_PARTY", "Invalid party size");
  }

  if (partySize > settings.maxPartyOnline || partySize < settings.minPartyOnline) {
    return jsonResponse(request, env, {
      serviceDate,
      partySize,
      channel: "online",
      slots: [],
      softExit: "party_out_of_range",
      largePartyMessage: settings.largePartyMessage,
      contactPhone: settings.contactPhone,
    });
  }

  const loaded = await loadAvailability(env, locationId, {
    serviceDate,
    partySize,
    channel: "online",
    now: new Date(),
  });
  if (!loaded) {
    return bookError(request, env, 404, "NOT_FOUND", "Venue not found");
  }

  const slots = loaded.slots
    .filter((s) => s.available)
    .map((s) => ({
      time: s.time,
      endTime: s.endTime,
      periodId: s.periodId,
    }));

  return jsonResponse(request, env, {
    serviceDate,
    partySize,
    channel: "online",
    slots,
    softExit: slots.length === 0 ? "day_full" : null,
    contactPhone: settings.contactPhone,
    largePartyMessage: settings.largePartyMessage,
  });
}

// ── POST /book/:slug/hold ────────────────────────────────────────────────────

export async function handleBookHold(
  request: Request,
  env: Env,
  slug: string
): Promise<Response> {
  const resolved = await resolveSlug(request, env, slug);
  if (resolved instanceof Response) return resolved;
  const { locationId, settings } = resolved;

  const ip = clientIp(request);
  for (const bucket of ["hold", "write"] as const) {
    const limited = await checkBookingRateLimit(env, bucket, ip);
    if (!limited.ok) {
      return bookError(request, env, 429, "RATE_LIMITED", "Too many requests");
    }
  }

  const body = await readJson(request);
  if (body === INVALID) {
    return bookError(request, env, 400, "INVALID_JSON", "Invalid JSON");
  }
  const parsed = BookHoldInputSchema.safeParse(body);
  if (!parsed.success) {
    return bookError(
      request,
      env,
      400,
      "INVALID_HOLD",
      "Hold failed validation",
      parsed.error.issues
    );
  }

  const blocked = await requireTurnstile(request, env, parsed.data.turnstileToken);
  if (blocked) return blocked;

  const { partySize, serviceDate, startTime } = parsed.data;
  const loaded = await loadAvailability(env, locationId, {
    serviceDate,
    partySize,
    channel: "online",
    now: new Date(),
  });
  if (!loaded) {
    return bookError(request, env, 404, "NOT_FOUND", "Venue not found");
  }

  const slot = loaded.slots.find((s) => s.time === startTime && s.available);
  const tableIds = slot?.assignment?.tableIds ?? [];
  if (!slot || tableIds.length === 0) {
    return bookError(
      request,
      env,
      409,
      "SLOT_TAKEN",
      "That time is no longer available",
      {
        alternatives: nearestAlternatives(loaded.slots, startTime)
          .filter((s) => s.available)
          .map((s) => s.time),
        contactPhone: settings.contactPhone,
      }
    );
  }

  const holdId = crypto.randomUUID();
  const held = await createHold(env, {
    holdId,
    locationId,
    serviceDate,
    startTime,
    endTime: slot.endTime,
    partySize,
    clientTokenHash: await hashClientToken(`${ip}:${holdId}`),
    ttlSeconds: settings.holdTtlSeconds,
    tableIds,
  });

  if (!held.ok) {
    return bookError(
      request,
      env,
      409,
      "SLOT_TAKEN",
      "That time was taken while you were booking",
      {
        alternatives: nearestAlternatives(loaded.slots, startTime)
          .filter((s) => s.available)
          .map((s) => s.time),
        contactPhone: settings.contactPhone,
      }
    );
  }

  const holdRow = await env.DB.prepare(
    `SELECT expires_at FROM reservation_holds WHERE id = ? AND organization_id = ?`
  )
    .bind(holdId, env.ORGANIZATION_ID)
    .first<{ expires_at: string }>();

  return jsonResponse(request, env, {
    holdToken: holdId,
    expiresAt: holdRow?.expires_at ?? null,
    serviceDate,
    startTime,
    endTime: slot.endTime,
    partySize,
  });
}

async function hashClientToken(raw: string): Promise<string> {
  const data = new TextEncoder().encode(raw);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ── POST /book/:slug/reserve ─────────────────────────────────────────────────

export async function handleBookReserve(
  request: Request,
  env: Env,
  slug: string
): Promise<Response> {
  const resolved = await resolveSlug(request, env, slug);
  if (resolved instanceof Response) return resolved;
  const { locationId, settings } = resolved;

  const ip = clientIp(request);
  for (const bucket of ["reserve", "write"] as const) {
    const limited = await checkBookingRateLimit(env, bucket, ip);
    if (!limited.ok) {
      return bookError(request, env, 429, "RATE_LIMITED", "Too many requests");
    }
  }
  const venueLimited = await checkBookingRateLimit(
    env,
    "venue_reserve",
    locationId
  );
  if (!venueLimited.ok) {
    return bookError(request, env, 429, "RATE_LIMITED", "Too many bookings right now");
  }

  const body = await readJson(request);
  if (body === INVALID) {
    return bookError(request, env, 400, "INVALID_JSON", "Invalid JSON");
  }
  const parsed = BookReserveInputSchema.safeParse(body);
  if (!parsed.success) {
    return bookError(
      request,
      env,
      400,
      "INVALID_RESERVE",
      "Reservation failed validation",
      parsed.error.issues
    );
  }
  const input = parsed.data;

  if (!input.guestEmail && !input.guestPhone) {
    return bookError(
      request,
      env,
      400,
      "CONTACT_REQUIRED",
      "Please leave an email or a phone number"
    );
  }

  const blocked = await requireTurnstile(request, env, input.turnstileToken);
  if (blocked) return blocked;

  const idempotencyKey =
    request.headers.get("Idempotency-Key")?.trim() || null;
  if (idempotencyKey) {
    const existing = await env.DB.prepare(
      `SELECT id FROM reservations
       WHERE organization_id = ? AND idempotency_key = ?`
    )
      .bind(env.ORGANIZATION_ID, idempotencyKey)
      .first<{ id: string }>();
    if (existing) {
      const reservation = await getReservation(env, existing.id);
      return jsonResponse(request, env, { reservation, manageToken: null }, 200);
    }
  }

  const hold = await env.DB.prepare(
    `SELECT id, service_date, start_time, end_time, party_size, expires_at, consumed_at
     FROM reservation_holds
     WHERE id = ? AND organization_id = ? AND location_id = ?`
  )
    .bind(input.holdToken, env.ORGANIZATION_ID, locationId)
    .first<{
      id: string;
      service_date: string;
      start_time: string;
      end_time: string;
      party_size: number;
      expires_at: string;
      consumed_at: string | null;
    }>();

  if (!hold || hold.consumed_at) {
    return bookError(request, env, 409, "HOLD_EXPIRED", "Your hold has expired — pick a time again");
  }

  const tableIds = await holdTableIds(env, hold.id);
  if (tableIds.length === 0) {
    return bookError(request, env, 409, "HOLD_EXPIRED", "Your hold has expired — pick a time again");
  }

  const reservationId = crypto.randomUUID();
  const { contactId } = await resolveGuest(env, {
    name: input.guestName,
    email: input.guestEmail ?? null,
    phone: input.guestPhone ?? null,
  });

  const startsAtUtc = localToUtcIso(
    hold.service_date,
    hold.start_time,
    settings.timezone
  );
  const roomId = await roomForTables(env, tableIds);
  const reference = generateReference();

  const created = domainEventStatement(env.DB, env.ORGANIZATION_ID, {
    type: "reservation.created",
    payload: {
      reservationId,
      locationId,
      serviceDate: hold.service_date,
      startTime: hold.start_time,
      partySize: hold.party_size,
      tableIds,
    },
  });

  try {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO reservations (
           id, organization_id, location_id, reference, contact_id, guest_name,
           guest_phone, guest_email, party_size, service_date, start_time, end_time,
           starts_at_utc, service_period_id, room_id, status, source,
           assignment_locked, occasion, allergies, guest_notes, marketing_opt_in,
           idempotency_key
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, 'confirmed', 'online', 0, ?, ?, ?, ?, ?)`
      ).bind(
        reservationId,
        env.ORGANIZATION_ID,
        locationId,
        reference,
        contactId,
        input.guestName,
        input.guestPhone ?? null,
        input.guestEmail ?? null,
        hold.party_size,
        hold.service_date,
        hold.start_time,
        hold.end_time,
        startsAtUtc,
        roomId,
        input.occasion ?? null,
        input.allergies ?? null,
        input.guestNotes ?? null,
        input.marketingOptIn ? 1 : 0,
        idempotencyKey
      ),
      ...tableIds.map((tableId) =>
        env.DB.prepare(
          `INSERT INTO reservation_tables (reservation_id, table_id) VALUES (?, ?)`
        ).bind(reservationId, tableId)
      ),
      reservationEventStatement(env, reservationId, "created", "guest:online", {
        partySize: hold.party_size,
        startTime: hold.start_time,
        tableIds,
      }),
      created.statement,
    ]);
  } catch (e) {
    const msg = String(e);
    if (idempotencyKey && (msg.includes("UNIQUE") || msg.includes("unique"))) {
      const existing = await env.DB.prepare(
        `SELECT id FROM reservations
         WHERE organization_id = ? AND idempotency_key = ?`
      )
        .bind(env.ORGANIZATION_ID, idempotencyKey)
        .first<{ id: string }>();
      if (existing) {
        const reservation = await getReservation(env, existing.id);
        return jsonResponse(request, env, { reservation, manageToken: null }, 200);
      }
    }
    throw e;
  }

  const consumed = await consumeHold(env, hold.id, reservationId);
  if (!consumed) {
    // Reservation row exists but hold expired mid-flight — still return it;
    // inventory is occupied by the reservation itself.
    console.warn("hold consume lost race after reserve insert", { holdId: hold.id });
  }

  const { rawToken } = await mintGuestToken(env, { reservationId });
  const ctx = await notifyContextFromReservation(
    env,
    locationId,
    reservationId,
    rawToken,
    settings
  );
  await scheduleBookingNotifications(env, ctx, {
    includeConfirmations: true,
    kind: "created",
  });
  // Inline dispatch so confirmation does not wait for cron.
  await dispatchDueNotifications(env, { limit: 10 });

  const reservation = await getReservation(env, reservationId);
  return jsonResponse(
    request,
    env,
    {
      reservation,
      manageToken: rawToken,
      manageUrl: manageUrl(env, rawToken),
    },
    201
  );
}

// ── GET /book/manage/:token ──────────────────────────────────────────────────

export async function handleBookManageGet(
  request: Request,
  env: Env,
  token: string
): Promise<Response> {
  const resolved = await resolveGuestToken(env, token);
  if (!resolved) {
    return bookError(request, env, 401, "INVALID_TOKEN", "This link is invalid or has expired");
  }

  const locationId = (
    await env.DB.prepare(
      `SELECT location_id FROM reservations WHERE id = ? AND organization_id = ?`
    )
      .bind(resolved.reservation.id, env.ORGANIZATION_ID)
      .first<{ location_id: string }>()
  )?.location_id;

  const venue = locationId ? await getVenueSettings(env, locationId) : null;

  const r = resolved.reservation;
  const canCancel = ["confirmed", "pending_payment"].includes(r.status);
  const canModify = r.status === "confirmed";

  return jsonResponse(request, env, {
    reservation: {
      reference: r.reference,
      guestName: r.guestName,
      partySize: r.partySize,
      serviceDate: r.serviceDate,
      startTime: r.startTime,
      endTime: r.endTime,
      status: r.status,
      occasion: r.occasion,
      allergies: r.allergies,
      guestNotes: r.guestNotes,
    },
    venue: venue
      ? {
          name: venueDisplayName(venue),
          addressText: venue.addressText,
          contactPhone: venue.contactPhone,
          brand: venue.brand,
        }
      : null,
    actions: { canCancel, canModify },
  });
}

// ── POST /book/manage/:token/cancel ──────────────────────────────────────────

export async function handleBookManageCancel(
  request: Request,
  env: Env,
  token: string
): Promise<Response> {
  const resolved = await resolveGuestToken(env, token);
  if (!resolved) {
    return bookError(request, env, 401, "INVALID_TOKEN", "This link is invalid or has expired");
  }

  const body = await readJson(request);
  const reason =
    body !== INVALID
      ? BookCancelInputSchema.safeParse(body).data?.reason ?? null
      : null;

  const existing = resolved.reservation;
  if (!["confirmed", "pending_payment", "seated"].includes(existing.status)) {
    return bookError(
      request,
      env,
      409,
      "INVALID_TRANSITION",
      `Cannot cancel a reservation that is ${existing.status}`
    );
  }

  const locationId = (
    await env.DB.prepare(
      `SELECT location_id FROM reservations WHERE id = ? AND organization_id = ?`
    )
      .bind(existing.id, env.ORGANIZATION_ID)
      .first<{ location_id: string }>()
  )!.location_id;

  await env.DB.batch([
    env.DB.prepare(
      `UPDATE reservations
       SET status = 'cancelled', cancelled_at = datetime('now'),
           cancel_reason = COALESCE(?, cancel_reason),
           cancelled_by = 'guest', updated_at = datetime('now')
       WHERE id = ? AND organization_id = ?`
    ).bind(reason, existing.id, env.ORGANIZATION_ID),
    reservationEventStatement(env, existing.id, "status.cancel", "guest:online", {
      from: existing.status,
      to: "cancelled",
      reason,
    }),
    domainEventStatement(env.DB, env.ORGANIZATION_ID, {
      type: "reservation.status_changed",
      payload: {
        reservationId: existing.id,
        serviceDate: existing.serviceDate,
        from: existing.status,
        to: "cancelled",
      },
    }).statement,
  ]);

  await cancelScheduledNotifications(env, existing.id);
  await revokeGuestTokensForReservation(env, existing.id);

  const settings = await getVenueSettings(env, locationId);
  if (existing.guestEmail) {
    await scheduleNotification(env, {
      locationId,
      reservationId: existing.id,
      channel: "email",
      template: "reservation_cancelled",
      toAddress: existing.guestEmail,
      scheduledFor: new Date(),
      payload: {
        guestName: existing.guestName,
        reference: existing.reference,
        serviceDate: existing.serviceDate,
        startTime: existing.startTime,
        partySize: existing.partySize,
        manageUrl: "",
        venueName: venueDisplayName(settings),
        addressText: settings.addressText,
        contactPhone: settings.contactPhone,
        brand: settings.brand,
      },
    });
    await dispatchDueNotifications(env, { limit: 5 });
  }

  return jsonResponse(request, env, {
    reservation: await getReservation(env, existing.id),
  });
}

// ── POST /book/manage/:token/modify ──────────────────────────────────────────

export async function handleBookManageModify(
  request: Request,
  env: Env,
  token: string
): Promise<Response> {
  const resolved = await resolveGuestToken(env, token);
  if (!resolved) {
    return bookError(request, env, 401, "INVALID_TOKEN", "This link is invalid or has expired");
  }

  const existing = resolved.reservation;
  if (existing.status !== "confirmed") {
    return bookError(
      request,
      env,
      409,
      "INVALID_TRANSITION",
      "Only confirmed bookings can be changed online"
    );
  }

  const body = await readJson(request);
  if (body === INVALID) {
    return bookError(request, env, 400, "INVALID_JSON", "Invalid JSON");
  }
  const parsed = BookModifyInputSchema.safeParse(body);
  if (!parsed.success) {
    return bookError(
      request,
      env,
      400,
      "INVALID_MODIFY",
      "Change failed validation",
      parsed.error.issues
    );
  }
  const input = parsed.data;

  const blocked = await requireTurnstile(request, env, input.turnstileToken);
  if (blocked) return blocked;

  const locationId = (
    await env.DB.prepare(
      `SELECT location_id FROM reservations WHERE id = ? AND organization_id = ?`
    )
      .bind(existing.id, env.ORGANIZATION_ID)
      .first<{ location_id: string }>()
  )!.location_id;
  const settings = await getVenueSettings(env, locationId);

  const hold = await env.DB.prepare(
    `SELECT id, service_date, start_time, end_time, party_size, consumed_at
     FROM reservation_holds
     WHERE id = ? AND organization_id = ? AND location_id = ?`
  )
    .bind(input.holdToken, env.ORGANIZATION_ID, locationId)
    .first<{
      id: string;
      service_date: string;
      start_time: string;
      end_time: string;
      party_size: number;
      consumed_at: string | null;
    }>();

  if (!hold || hold.consumed_at) {
    return bookError(request, env, 409, "HOLD_EXPIRED", "Your hold has expired — pick a time again");
  }

  const tableIds = await holdTableIds(env, hold.id);
  const startsAtUtc = localToUtcIso(
    hold.service_date,
    hold.start_time,
    settings.timezone
  );
  const roomId = await roomForTables(env, tableIds);

  await env.DB.batch([
    env.DB.prepare(
      `UPDATE reservations SET
         guest_name = COALESCE(?, guest_name),
         guest_phone = COALESCE(?, guest_phone),
         guest_email = COALESCE(?, guest_email),
         party_size = ?,
         service_date = ?, start_time = ?, end_time = ?, starts_at_utc = ?,
         room_id = ?, occasion = COALESCE(?, occasion),
         allergies = COALESCE(?, allergies),
         guest_notes = COALESCE(?, guest_notes),
         assignment_locked = 0,
         updated_at = datetime('now')
       WHERE id = ? AND organization_id = ?`
    ).bind(
      input.guestName ?? null,
      input.guestPhone === undefined ? null : input.guestPhone,
      input.guestEmail === undefined ? null : input.guestEmail,
      hold.party_size,
      hold.service_date,
      hold.start_time,
      hold.end_time,
      startsAtUtc,
      roomId,
      input.occasion ?? null,
      input.allergies ?? null,
      input.guestNotes ?? null,
      existing.id,
      env.ORGANIZATION_ID
    ),
    env.DB.prepare(`DELETE FROM reservation_tables WHERE reservation_id = ?`).bind(
      existing.id
    ),
    ...tableIds.map((tableId) =>
      env.DB.prepare(
        `INSERT INTO reservation_tables (reservation_id, table_id) VALUES (?, ?)`
      ).bind(existing.id, tableId)
    ),
    reservationEventStatement(env, existing.id, "updated", "guest:online", {
      serviceDate: hold.service_date,
      startTime: hold.start_time,
      partySize: hold.party_size,
    }),
    domainEventStatement(env.DB, env.ORGANIZATION_ID, {
      type: "reservation.updated",
      payload: {
        reservationId: existing.id,
        serviceDate: hold.service_date,
        patch: {
          serviceDate: hold.service_date,
          startTime: hold.start_time,
          partySize: hold.party_size,
        },
      },
    }).statement,
  ]);

  await consumeHold(env, hold.id, existing.id);
  await cancelScheduledNotifications(env, existing.id);

  const ctx = await notifyContextFromReservation(
    env,
    locationId,
    existing.id,
    token,
    settings
  );
  await scheduleBookingNotifications(env, ctx, {
    includeConfirmations: true,
    kind: "changed",
  });
  await dispatchDueNotifications(env, { limit: 10 });

  return jsonResponse(request, env, {
    reservation: await getReservation(env, existing.id),
  });
}

/** Dispatch entry for /book/* paths from index.ts */
export async function handleBookRoutes(
  request: Request,
  env: Env,
  path: string
): Promise<Response | null> {
  const manageMatch = path.match(/^\/book\/manage\/([^/]+)(?:\/(cancel|modify))?$/);
  if (manageMatch) {
    const token = decodeURIComponent(manageMatch[1]);
    const action = manageMatch[2];
    if (!action && request.method === "GET") {
      return handleBookManageGet(request, env, token);
    }
    if (action === "cancel" && request.method === "POST") {
      return handleBookManageCancel(request, env, token);
    }
    if (action === "modify" && request.method === "POST") {
      return handleBookManageModify(request, env, token);
    }
    return bookError(request, env, 405, "METHOD_NOT_ALLOWED", "Method not allowed");
  }

  const slugMatch = path.match(
    /^\/book\/([^/]+)\/(venue|days|availability|hold|reserve)$/
  );
  if (!slugMatch) return null;

  const slug = decodeURIComponent(slugMatch[1]);
  const action = slugMatch[2];

  if (action === "venue" && request.method === "GET") {
    return handleBookVenue(request, env, slug);
  }
  if (action === "days" && request.method === "GET") {
    return handleBookDays(request, env, slug);
  }
  if (action === "availability" && request.method === "GET") {
    return handleBookAvailability(request, env, slug);
  }
  if (action === "hold" && request.method === "POST") {
    return handleBookHold(request, env, slug);
  }
  if (action === "reserve" && request.method === "POST") {
    return handleBookReserve(request, env, slug);
  }

  return bookError(request, env, 405, "METHOD_NOT_ALLOWED", "Method not allowed");
}
