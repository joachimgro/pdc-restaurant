import {
  AssignTablesInputSchema,
  CreateReservationInputSchema,
  PatchReservationInputSchema,
  ReservationStatusInputSchema,
  type Reservation,
  type ReservationStatus,
  type ReservationStatusAction,
} from "@lead-intake/shared-types";
import { jsonResponse } from "../cors";
import { getStaffSession, type StaffSession } from "../auth/session";
import { getDefaultLocation } from "../db/locations";
import { domainEventStatement } from "../db/events";
import type { Env } from "../env";
import {
  loadAvailability,
  nearestAlternatives,
} from "../plugins/service/availability-loader";
import type { AvailabilitySlot } from "../plugins/service/availability";
import { assignTables } from "../plugins/service/assignment";
import { createHold, consumeHold } from "../plugins/service/holds";
import { resolveGuest } from "../plugins/service/guests";
import { generateReference } from "../plugins/service/reference";
import {
  conflictingTableIds,
  getReservation,
  listReservationEvents,
  reservationEventStatement,
  reservationTableIds,
} from "../plugins/service/db/reservations";
import { getVenueSettings } from "../plugins/service/db/venue";
import { listServicePeriods } from "../plugins/service/db/periods";
import { listReservationsForDate } from "../plugins/service/db/day";
import {
  dayOfWeekForDate,
  localToUtcIso,
  venueLocalDate,
} from "../plugins/service/time";

// ── Shared plumbing ──────────────────────────────────────────────────────────

const INVALID = Symbol("invalid-json");

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

async function readJson(request: Request): Promise<unknown | typeof INVALID> {
  try {
    return await request.json();
  } catch {
    return INVALID;
  }
}

/** Who did it, for the reservation's own audit log. */
function actorOf(session: StaffSession): string {
  return `staff:${session.row.id}`;
}

// ── GET /service/availability ────────────────────────────────────────────────

export async function handleGetAvailability(
  request: Request,
  env: Env
): Promise<Response> {
  const session = await requireSession(request, env);
  if (session instanceof Response) return session;

  const locationId = await resolveLocationId(request, env);
  if (!locationId) {
    return serviceError(request, env, 404, "NO_LOCATION", "No location configured");
  }

  const url = new URL(request.url);
  const settings = await getVenueSettings(env, locationId);
  if (!settings) {
    return serviceError(request, env, 404, "NO_SETTINGS", "Venue is not configured");
  }

  const now = new Date();
  const serviceDate =
    url.searchParams.get("date") ?? venueLocalDate(now, settings.timezone);
  const partySize = Number(url.searchParams.get("partySize") ?? "2");

  if (!Number.isInteger(partySize) || partySize < 1) {
    return serviceError(
      request,
      env,
      400,
      "INVALID_PARTY_SIZE",
      "partySize must be a positive integer"
    );
  }

  // channel is required — never default. Staff and online inventory rules differ
  // (party bounds, reserveLargeTables, online_bookable). A silent staff default
  // would let a guest caller sell staff-only inventory; see §20.
  const channelParam = url.searchParams.get("channel");
  if (channelParam !== "online" && channelParam !== "staff") {
    return serviceError(
      request,
      env,
      400,
      "CHANNEL_REQUIRED",
      "channel must be 'staff' or 'online'"
    );
  }
  const channel = channelParam;
  const roomIds = url.searchParams.get("roomIds")?.split(",").filter(Boolean);

  const loaded = await loadAvailability(env, locationId, {
    serviceDate,
    partySize,
    channel,
    now,
    roomIds: roomIds?.length ? roomIds : undefined,
  });
  if (!loaded) {
    return serviceError(request, env, 404, "NO_SETTINGS", "Venue is not configured");
  }

  return jsonResponse(request, env, {
    serviceDate,
    partySize,
    channel,
    // Unavailable slots are included, each with its reason — "why can't I
    // book 8pm" is the question this endpoint exists to answer.
    slots: loaded.slots,
    largePartyMessage: loaded.slots.some((s) => s.reason === "party_too_large")
      ? settings.largePartyMessage
      : null,
  });
}

// ── GET /service/day ─────────────────────────────────────────────────────────

/**
 * Everything the console needs to render one service date in a single request.
 *
 * Deliberately does not include the floor plan: it changes rarely and already
 * has its own cacheable route, so the console fetches the two in parallel
 * rather than re-sending 28 tables on every date change.
 *
 * Summary figures are left to the client, which has every reservation here and
 * the tables from the floor plan — computing them twice in two places is how
 * the header strip and the list start disagreeing.
 */
export async function handleGetServiceDay(
  request: Request,
  env: Env
): Promise<Response> {
  const session = await requireSession(request, env);
  if (session instanceof Response) return session;

  const locationId = await resolveLocationId(request, env);
  if (!locationId) {
    return serviceError(request, env, 404, "NO_LOCATION", "No location configured");
  }

  const settings = await getVenueSettings(env, locationId);
  if (!settings) {
    return serviceError(request, env, 404, "NO_SETTINGS", "Venue is not configured");
  }

  const url = new URL(request.url);
  const serviceDate =
    url.searchParams.get("date") ?? venueLocalDate(new Date(), settings.timezone);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(serviceDate)) {
    return serviceError(
      request,
      env,
      400,
      "INVALID_DATE",
      "date must be YYYY-MM-DD"
    );
  }

  const [periodsResponse, reservations] = await Promise.all([
    listServicePeriods(env, locationId),
    listReservationsForDate(env, locationId, serviceDate),
  ]);

  const weekday = dayOfWeekForDate(serviceDate);

  return jsonResponse(request, env, {
    serviceDate,
    settings,
    periods: periodsResponse.periods.filter(
      (p) => p.isActive && p.dayOfWeek === weekday
    ),
    venueTurnRules: periodsResponse.venueTurnRules,
    venuePacingRules: periodsResponse.venuePacingRules,
    reservations,
  });
}

// ── POST /service/reservations ───────────────────────────────────────────────

export async function handleCreateReservation(
  request: Request,
  env: Env
): Promise<Response> {
  const session = await requireSession(request, env);
  if (session instanceof Response) return session;

  const locationId = await resolveLocationId(request, env);
  if (!locationId) {
    return serviceError(request, env, 404, "NO_LOCATION", "No location configured");
  }

  const body = await readJson(request);
  if (body === INVALID) {
    return serviceError(request, env, 400, "INVALID_JSON", "Invalid JSON");
  }

  const parsed = CreateReservationInputSchema.safeParse(body);
  if (!parsed.success) {
    return serviceError(
      request,
      env,
      400,
      "INVALID_RESERVATION",
      "Reservation failed validation",
      parsed.error.issues
    );
  }
  const input = parsed.data;

  const settings = await getVenueSettings(env, locationId);
  if (!settings) {
    return serviceError(request, env, 404, "NO_SETTINGS", "Venue is not configured");
  }

  const now = new Date();
  const loaded = await loadAvailability(env, locationId, {
    serviceDate: input.serviceDate,
    partySize: input.partySize,
    channel: "staff",
    now,
  });
  if (!loaded) {
    return serviceError(request, env, 404, "NO_SETTINGS", "Venue is not configured");
  }

  const slot = loaded.slots.find((s) => s.time === input.startTime);
  if (!slot) {
    return serviceError(
      request,
      env,
      409,
      "SLOT_TAKEN",
      `No service period covers ${input.startTime} on ${input.serviceDate}`,
      { alternatives: nearestAlternatives(loaded.slots, input.startTime) }
    );
  }

  // Explicit tables from staff override the engine's choice; otherwise take
  // the assignment the availability pass already computed.
  const tableIds = input.tableIds?.length
    ? input.tableIds
    : (slot.assignment?.tableIds ?? []);

  if (tableIds.length === 0) {
    return slotUnavailable(request, env, slot, loaded.slots, input.startTime);
  }

  const holdId = crypto.randomUUID();
  const reservationId = crypto.randomUUID();

  // One write path: staff take a hold and consume it in the same request, so
  // the concurrency mechanism is exercised by the only caller that exists
  // rather than sitting untested until the guest flow arrives.
  const held = await createHold(env, {
    holdId,
    locationId,
    serviceDate: input.serviceDate,
    startTime: input.startTime,
    endTime: slot.endTime,
    partySize: input.partySize,
    clientTokenHash: `staff:${session.row.id}:${reservationId}`,
    ttlSeconds: settings.holdTtlSeconds,
    tableIds,
  });

  if (!held.ok) {
    return serviceError(
      request,
      env,
      409,
      "SLOT_TAKEN",
      "That table was taken while you were booking",
      { alternatives: nearestAlternatives(loaded.slots, input.startTime) }
    );
  }

  const { contactId } = await resolveGuest(env, {
    name: input.guestName,
    email: input.guestEmail ?? null,
    phone: input.guestPhone ?? null,
  });

  const startsAtUtc = localToUtcIso(
    input.serviceDate,
    input.startTime,
    settings.timezone
  );
  const roomId = await roomForTables(env, tableIds);

  const created = domainEventStatement(env.DB, env.ORGANIZATION_ID, {
    type: "reservation.created",
    payload: {
      reservationId,
      locationId,
      serviceDate: input.serviceDate,
      startTime: input.startTime,
      partySize: input.partySize,
      tableIds,
    },
  });

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO reservations (
         id, organization_id, location_id, reference, contact_id, guest_name,
         guest_phone, guest_email, party_size, service_date, start_time, end_time,
         starts_at_utc, service_period_id, room_id, status, source,
         assignment_locked, occasion, allergies, guest_notes, staff_notes,
         tags_json, marketing_opt_in, created_by_staff_id
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      reservationId,
      env.ORGANIZATION_ID,
      locationId,
      generateReference(),
      contactId,
      input.guestName,
      input.guestPhone ?? null,
      input.guestEmail ?? null,
      input.partySize,
      input.serviceDate,
      input.startTime,
      slot.endTime,
      startsAtUtc,
      slot.periodId,
      roomId,
      input.source ?? "staff",
      input.tableIds?.length ? 1 : 0,
      input.occasion ?? null,
      input.allergies ?? null,
      input.guestNotes ?? null,
      input.staffNotes ?? null,
      JSON.stringify(input.tags ?? []),
      input.marketingOptIn ? 1 : 0,
      session.row.id
    ),
    ...tableIds.map((tableId) =>
      env.DB.prepare(
        `INSERT INTO reservation_tables (reservation_id, table_id) VALUES (?, ?)`
      ).bind(reservationId, tableId)
    ),
    reservationEventStatement(env, reservationId, "created", actorOf(session), {
      partySize: input.partySize,
      startTime: input.startTime,
      tableIds,
    }),
    created.statement,
  ]);

  // The hold has done its job the moment the reservation rows exist.
  await consumeHold(env, holdId, reservationId);

  const reservation = await getReservation(env, reservationId);
  return jsonResponse(request, env, reservation, 201);
}

function slotUnavailable(
  request: Request,
  env: Env,
  slot: AvailabilitySlot,
  slots: AvailabilitySlot[],
  wantedTime: string
): Response {
  const code = slot.reason === "pacing_full" ? "PACING_FULL" : "SLOT_TAKEN";
  return serviceError(
    request,
    env,
    409,
    code,
    slot.reason
      ? `That time is not available: ${slot.reason.replace(/_/g, " ")}`
      : "That time is not available",
    {
      reason: slot.reason ?? null,
      alternatives: nearestAlternatives(slots, wantedTime),
    }
  );
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

// ── GET /service/reservations/:id ────────────────────────────────────────────

export async function handleGetReservation(
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

  const body: Record<string, unknown> = {
    reservation,
    events: await listReservationEvents(env, reservationId),
  };

  if (reservation.contactId) {
    const { getOrCreateProfile } = await import(
      "../plugins/service/db/guest-profiles"
    );
    body.guestProfile = await getOrCreateProfile(env, reservation.contactId);
  }

  const { depositsEnabled } = await import("../capabilities");
  if (depositsEnabled(env)) {
    const { getPaymentByReservation } = await import(
      "../plugins/service/db/payments"
    );
    body.payment = await getPaymentByReservation(env, reservationId);
  }

  return jsonResponse(request, env, body);
}

// ── PATCH /service/reservations/:id ──────────────────────────────────────────

export async function handlePatchReservation(
  request: Request,
  env: Env,
  reservationId: string
): Promise<Response> {
  const session = await requireSession(request, env);
  if (session instanceof Response) return session;

  const locationId = await resolveLocationId(request, env);
  if (!locationId) {
    return serviceError(request, env, 404, "NO_LOCATION", "No location configured");
  }

  const existing = await getReservation(env, reservationId);
  if (!existing) {
    return serviceError(request, env, 404, "NOT_FOUND", "Reservation not found");
  }

  const body = await readJson(request);
  if (body === INVALID) {
    return serviceError(request, env, 400, "INVALID_JSON", "Invalid JSON");
  }
  const parsed = PatchReservationInputSchema.safeParse(body);
  if (!parsed.success) {
    return serviceError(
      request,
      env,
      400,
      "INVALID_RESERVATION",
      "Reservation failed validation",
      parsed.error.issues
    );
  }
  const patch = parsed.data;

  const settings = await getVenueSettings(env, locationId);
  if (!settings) {
    return serviceError(request, env, 404, "NO_SETTINGS", "Venue is not configured");
  }

  const serviceDate = patch.serviceDate ?? existing.serviceDate;
  const startTime = patch.startTime ?? existing.startTime;
  const partySize = patch.partySize ?? existing.partySize;

  const windowChanged =
    serviceDate !== existing.serviceDate ||
    startTime !== existing.startTime ||
    partySize !== existing.partySize;

  let endTime = existing.endTime;
  let tableIds = existing.tableIds;
  let assignmentLocked = existing.assignmentLocked;
  let unassignedWarning = false;

  if (windowChanged) {
    // People are physically sitting there. Nothing reschedules a seated table.
    if (existing.status === "seated") {
      return serviceError(
        request,
        env,
        409,
        "ALREADY_SEATED",
        "This party is seated — finish or move them from the floor plan instead"
      );
    }

    const loaded = await loadAvailability(env, locationId, {
      serviceDate,
      partySize,
      channel: "staff",
      now: new Date(),
    });
    if (!loaded) {
      return serviceError(request, env, 404, "NO_SETTINGS", "Venue is not configured");
    }

    const slot = loaded.slots.find((s) => s.time === startTime);
    if (!slot) {
      return serviceError(
        request,
        env,
        409,
        "SLOT_TAKEN",
        `No service period covers ${startTime} on ${serviceDate}`,
        { alternatives: nearestAlternatives(loaded.slots, startTime) }
      );
    }
    endTime = slot.endTime;

    if (existing.assignmentLocked) {
      // A manager's choice outranks the algorithm permanently, so the only
      // question is whether their tables still work.
      const conflicts = await conflictingTableIds(
        env,
        locationId,
        serviceDate,
        startTime,
        endTime,
        existing.tableIds,
        reservationId
      );

      if (conflicts.length > 0) {
        // Never silently unlock. Return the conflict with the assignment the
        // engine would have picked, so the UI can offer an explicit
        // "unlock and move" rather than a dead end.
        return serviceError(
          request,
          env,
          409,
          "ASSIGNMENT_CONFLICT",
          "The locked tables are not free at the new time",
          {
            conflictingTableIds: conflicts,
            suggestedAssignment: slot.assignment,
            alternatives: nearestAlternatives(loaded.slots, startTime),
          }
        );
      }
    } else {
      // Unlocked: clear and re-solve. An unassigned result is a legitimate
      // state the console surfaces, not a reason to block the edit.
      tableIds = slot.assignment?.tableIds ?? [];
      assignmentLocked = false;
      unassignedWarning = tableIds.length === 0;
    }
  }

  const startsAtUtc = localToUtcIso(serviceDate, startTime, settings.timezone);
  const tablesChanged =
    tableIds.join(",") !== existing.tableIds.join(",");

  const statements: D1PreparedStatement[] = [
    env.DB.prepare(
      `UPDATE reservations SET
         guest_name = ?, guest_phone = ?, guest_email = ?, party_size = ?,
         service_date = ?, start_time = ?, end_time = ?, starts_at_utc = ?,
         occasion = ?, allergies = ?, guest_notes = ?, staff_notes = ?,
         tags_json = ?, assignment_locked = ?, updated_at = datetime('now')
       WHERE id = ? AND organization_id = ?`
    ).bind(
      patch.guestName ?? existing.guestName,
      patch.guestPhone !== undefined ? patch.guestPhone : existing.guestPhone,
      patch.guestEmail !== undefined ? patch.guestEmail : existing.guestEmail,
      partySize,
      serviceDate,
      startTime,
      endTime,
      startsAtUtc,
      patch.occasion !== undefined ? patch.occasion : existing.occasion,
      patch.allergies !== undefined ? patch.allergies : existing.allergies,
      patch.guestNotes !== undefined ? patch.guestNotes : existing.guestNotes,
      patch.staffNotes !== undefined ? patch.staffNotes : existing.staffNotes,
      JSON.stringify(patch.tags ?? existing.tags),
      assignmentLocked ? 1 : 0,
      reservationId,
      env.ORGANIZATION_ID
    ),
    reservationEventStatement(env, reservationId, "updated", actorOf(session), patch),
    domainEventStatement(env.DB, env.ORGANIZATION_ID, {
      type: "reservation.updated",
      payload: { reservationId, serviceDate, patch },
    }).statement,
  ];

  if (tablesChanged) {
    statements.push(
      env.DB.prepare(
        `DELETE FROM reservation_tables WHERE reservation_id = ?`
      ).bind(reservationId),
      ...tableIds.map((tableId) =>
        env.DB.prepare(
          `INSERT INTO reservation_tables (reservation_id, table_id) VALUES (?, ?)`
        ).bind(reservationId, tableId)
      ),
      domainEventStatement(env.DB, env.ORGANIZATION_ID, {
        type: "reservation.assigned",
        payload: { reservationId, serviceDate, tableIds, assignmentLocked },
      }).statement
    );
  }

  await env.DB.batch(statements);

  const reservation = await getReservation(env, reservationId);
  return jsonResponse(request, env, {
    reservation,
    warning: unassignedWarning ? "UNASSIGNED" : null,
  });
}

// ── POST /service/reservations/:id/status ────────────────────────────────────

const TRANSITIONS: Record<
  ReservationStatusAction,
  { to: ReservationStatus; from: ReservationStatus[]; stamp?: string }
> = {
  seat: { to: "seated", from: ["confirmed", "pending_payment"], stamp: "seated_at" },
  finish: { to: "finished", from: ["seated"], stamp: "finished_at" },
  no_show: {
    to: "no_show",
    from: ["confirmed", "pending_payment"],
    stamp: "no_show_marked_at",
  },
  cancel: {
    to: "cancelled",
    from: ["confirmed", "pending_payment", "seated"],
    stamp: "cancelled_at",
  },
  reinstate: { to: "confirmed", from: ["cancelled", "no_show"] },
};

export async function handleReservationStatus(
  request: Request,
  env: Env,
  reservationId: string
): Promise<Response> {
  const session = await requireSession(request, env);
  if (session instanceof Response) return session;

  const existing = await getReservation(env, reservationId);
  if (!existing) {
    return serviceError(request, env, 404, "NOT_FOUND", "Reservation not found");
  }

  const body = await readJson(request);
  if (body === INVALID) {
    return serviceError(request, env, 400, "INVALID_JSON", "Invalid JSON");
  }
  const parsed = ReservationStatusInputSchema.safeParse(body);
  if (!parsed.success) {
    return serviceError(
      request,
      env,
      400,
      "INVALID_ACTION",
      "Unknown status action",
      parsed.error.issues
    );
  }

  const transition = TRANSITIONS[parsed.data.action];
  if (!transition.from.includes(existing.status)) {
    return serviceError(
      request,
      env,
      409,
      "INVALID_TRANSITION",
      `Cannot ${parsed.data.action} a reservation that is ${existing.status}`,
      { from: existing.status, allowedFrom: transition.from }
    );
  }

  // Reinstating clears the stamps that marked the reservation dead, or the
  // console shows a live booking still carrying a cancellation time.
  const clearStamps =
    parsed.data.action === "reinstate"
      ? `, cancelled_at = NULL, cancel_reason = NULL, no_show_marked_at = NULL`
      : "";
  const setStamp = transition.stamp
    ? `, ${transition.stamp} = datetime('now')`
    : "";

  await env.DB.batch([
    env.DB.prepare(
      `UPDATE reservations
       SET status = ?, cancel_reason = COALESCE(?, cancel_reason),
           updated_at = datetime('now')${setStamp}${clearStamps}
       WHERE id = ? AND organization_id = ?`
    ).bind(
      transition.to,
      parsed.data.reason ?? null,
      reservationId,
      env.ORGANIZATION_ID
    ),
    reservationEventStatement(
      env,
      reservationId,
      `status.${parsed.data.action}`,
      actorOf(session),
      { from: existing.status, to: transition.to, reason: parsed.data.reason ?? null }
    ),
    domainEventStatement(env.DB, env.ORGANIZATION_ID, {
      type: "reservation.status_changed",
      payload: {
        reservationId,
        serviceDate: existing.serviceDate,
        from: existing.status,
        to: transition.to,
      },
    }).statement,
  ]);

  if (parsed.data.action === "cancel") {
    const { cancelScheduledNotifications } = await import(
      "../notifications/schedule"
    );
    await cancelScheduledNotifications(env, reservationId);
  }

  if (
    existing.contactId &&
    ["finish", "no_show", "cancel"].includes(parsed.data.action)
  ) {
    const { recalcGuestProfile } = await import(
      "../plugins/service/db/guest-profiles"
    );
    await recalcGuestProfile(env, existing.contactId);
  }

  const responseBody: Record<string, unknown> = {
    reservation: await getReservation(env, reservationId),
  };

  if (existing.contactId) {
    const { getOrCreateProfile } = await import(
      "../plugins/service/db/guest-profiles"
    );
    responseBody.guestProfile = await getOrCreateProfile(
      env,
      existing.contactId
    );
  }

  const { depositsEnabled } = await import("../capabilities");
  if (depositsEnabled(env)) {
    const { getPaymentByReservation } = await import(
      "../plugins/service/db/payments"
    );
    responseBody.payment = await getPaymentByReservation(env, reservationId);
  }

  return jsonResponse(request, env, responseBody);
}

// ── PUT /service/reservations/:id/tables ─────────────────────────────────────

export async function handleAssignTables(
  request: Request,
  env: Env,
  reservationId: string
): Promise<Response> {
  const session = await requireSession(request, env);
  if (session instanceof Response) return session;

  const locationId = await resolveLocationId(request, env);
  if (!locationId) {
    return serviceError(request, env, 404, "NO_LOCATION", "No location configured");
  }

  const existing = await getReservation(env, reservationId);
  if (!existing) {
    return serviceError(request, env, 404, "NOT_FOUND", "Reservation not found");
  }

  const body = await readJson(request);
  if (body === INVALID) {
    return serviceError(request, env, 400, "INVALID_JSON", "Invalid JSON");
  }
  const parsed = AssignTablesInputSchema.safeParse(body);
  if (!parsed.success) {
    return serviceError(
      request,
      env,
      400,
      "INVALID_ASSIGNMENT",
      "Assignment failed validation",
      parsed.error.issues
    );
  }
  const { tableIds, swapWithReservationId } = parsed.data;

  const unknown = await unknownTableIds(env, locationId, tableIds);
  if (unknown.length > 0) {
    return serviceError(
      request,
      env,
      400,
      "UNKNOWN_TABLE",
      "Some tables do not belong to this venue",
      { tableIds: unknown }
    );
  }

  // Atomic swap: A takes B's tables (or the requested set), B takes A's.
  if (swapWithReservationId) {
    if (swapWithReservationId === reservationId) {
      return serviceError(
        request,
        env,
        400,
        "INVALID_ASSIGNMENT",
        "Cannot swap a booking with itself"
      );
    }
    const other = await getReservation(env, swapWithReservationId);
    if (!other || other.locationId !== locationId) {
      return serviceError(request, env, 404, "NOT_FOUND", "Swap target not found");
    }
    if (other.serviceDate !== existing.serviceDate) {
      return serviceError(
        request,
        env,
        400,
        "INVALID_ASSIGNMENT",
        "Can only swap bookings on the same service date"
      );
    }

    const aNew = tableIds.length > 0 ? tableIds : other.tableIds;
    const bNew = existing.tableIds;
    if (aNew.length === 0) {
      return serviceError(
        request,
        env,
        400,
        "INVALID_ASSIGNMENT",
        "Swap target has no tables"
      );
    }

    const excludeBoth = [reservationId, swapWithReservationId];
    const conflictsA = await conflictingTableIds(
      env,
      locationId,
      existing.serviceDate,
      existing.startTime,
      existing.endTime,
      aNew,
      excludeBoth
    );
    const conflictsB =
      bNew.length === 0
        ? []
        : await conflictingTableIds(
            env,
            locationId,
            other.serviceDate,
            other.startTime,
            other.endTime,
            bNew,
            excludeBoth
          );
    if (conflictsA.length > 0 || conflictsB.length > 0) {
      return serviceError(
        request,
        env,
        409,
        "SLOT_TAKEN",
        "Those tables are already booked for this window",
        {
          conflictingTableIds: [...new Set([...conflictsA, ...conflictsB])],
          alternatives: [],
        }
      );
    }

    const actor = actorOf(session);
    const statements = [
      env.DB.prepare(
        `DELETE FROM reservation_tables WHERE reservation_id IN (?, ?)`
      ).bind(reservationId, swapWithReservationId),
      ...aNew.map((tableId) =>
        env.DB.prepare(
          `INSERT INTO reservation_tables (reservation_id, table_id) VALUES (?, ?)`
        ).bind(reservationId, tableId)
      ),
      ...bNew.map((tableId) =>
        env.DB.prepare(
          `INSERT INTO reservation_tables (reservation_id, table_id) VALUES (?, ?)`
        ).bind(swapWithReservationId, tableId)
      ),
      env.DB.prepare(
        `UPDATE reservations SET assignment_locked = 1, room_id = COALESCE(
           (SELECT room_id FROM dining_tables WHERE id = ?), room_id
         ), updated_at = datetime('now')
         WHERE id = ? AND organization_id = ?`
      ).bind(aNew[0], reservationId, env.ORGANIZATION_ID),
      ...(bNew[0]
        ? [
            env.DB.prepare(
              `UPDATE reservations SET assignment_locked = 1, room_id = COALESCE(
                 (SELECT room_id FROM dining_tables WHERE id = ?), room_id
               ), updated_at = datetime('now')
               WHERE id = ? AND organization_id = ?`
            ).bind(bNew[0], swapWithReservationId, env.ORGANIZATION_ID),
          ]
        : [
            env.DB.prepare(
              `UPDATE reservations SET assignment_locked = 1, updated_at = datetime('now')
               WHERE id = ? AND organization_id = ?`
            ).bind(swapWithReservationId, env.ORGANIZATION_ID),
          ]),
      reservationEventStatement(env, reservationId, "assigned", actor, {
        tableIds: aNew,
        previousTableIds: existing.tableIds,
        swappedWith: swapWithReservationId,
      }),
      reservationEventStatement(env, swapWithReservationId, "assigned", actor, {
        tableIds: bNew,
        previousTableIds: other.tableIds,
        swappedWith: reservationId,
      }),
      domainEventStatement(env.DB, env.ORGANIZATION_ID, {
        type: "reservation.assigned",
        payload: {
          reservationId,
          serviceDate: existing.serviceDate,
          tableIds: aNew,
          assignmentLocked: true,
          swappedWith: swapWithReservationId,
        },
      }).statement,
      domainEventStatement(env.DB, env.ORGANIZATION_ID, {
        type: "reservation.assigned",
        payload: {
          reservationId: swapWithReservationId,
          serviceDate: other.serviceDate,
          tableIds: bNew,
          assignmentLocked: true,
          swappedWith: reservationId,
        },
      }).statement,
    ];
    await env.DB.batch(statements);

    return jsonResponse(request, env, await getReservation(env, reservationId));
  }

  const conflicts = await conflictingTableIds(
    env,
    locationId,
    existing.serviceDate,
    existing.startTime,
    existing.endTime,
    tableIds,
    reservationId
  );
  if (conflicts.length > 0) {
    return serviceError(
      request,
      env,
      409,
      "SLOT_TAKEN",
      "Those tables are already booked for this window",
      { conflictingTableIds: conflicts, alternatives: [] }
    );
  }

  await env.DB.batch([
    env.DB.prepare(
      `DELETE FROM reservation_tables WHERE reservation_id = ?`
    ).bind(reservationId),
    ...tableIds.map((tableId) =>
      env.DB.prepare(
        `INSERT INTO reservation_tables (reservation_id, table_id) VALUES (?, ?)`
      ).bind(reservationId, tableId)
    ),
    // A manual assignment is a decision, not a suggestion: lock it so no
    // later re-solve can move it.
    env.DB.prepare(
      `UPDATE reservations SET assignment_locked = 1, room_id = COALESCE(
         (SELECT room_id FROM dining_tables WHERE id = ?), room_id
       ), updated_at = datetime('now')
       WHERE id = ? AND organization_id = ?`
    ).bind(tableIds[0], reservationId, env.ORGANIZATION_ID),
    reservationEventStatement(env, reservationId, "assigned", actorOf(session), {
      tableIds,
      previousTableIds: existing.tableIds,
    }),
    domainEventStatement(env.DB, env.ORGANIZATION_ID, {
      type: "reservation.assigned",
      payload: {
        reservationId,
        serviceDate: existing.serviceDate,
        tableIds,
        assignmentLocked: true,
      },
    }).statement,
  ]);

  return jsonResponse(request, env, await getReservation(env, reservationId));
}

async function unknownTableIds(
  env: Env,
  locationId: string,
  tableIds: string[]
): Promise<string[]> {
  const placeholders = tableIds.map(() => "?").join(", ");
  const { results } = await env.DB.prepare(
    `SELECT id FROM dining_tables
     WHERE location_id = ? AND organization_id = ? AND id IN (${placeholders})`
  )
    .bind(locationId, env.ORGANIZATION_ID, ...tableIds)
    .all<{ id: string }>();

  const known = new Set((results ?? []).map((r) => r.id));
  return tableIds.filter((id) => !known.has(id));
}

export type { Reservation };
export { reservationTableIds };
