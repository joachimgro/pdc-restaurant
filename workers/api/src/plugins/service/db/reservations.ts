import {
  OCCUPYING_STATUSES,
  type Reservation,
  type ReservationEvent,
} from "@lead-intake/shared-types";
import type { Env } from "../../../env";
import type { OccupancyRow } from "../availability";
import { toBool } from "../types";

export type ReservationRow = {
  id: string;
  organization_id: string;
  location_id: string;
  reference: string;
  contact_id: string | null;
  guest_name: string;
  guest_phone: string | null;
  guest_email: string | null;
  party_size: number;
  service_date: string;
  start_time: string;
  end_time: string;
  starts_at_utc: string;
  service_period_id: string | null;
  room_id: string | null;
  status: string;
  source: string;
  assignment_locked: number;
  occasion: string | null;
  allergies: string | null;
  guest_notes: string | null;
  staff_notes: string | null;
  tags_json: string | null;
  deposit_required_pence: number;
  seated_at: string | null;
  finished_at: string | null;
  cancelled_at: string | null;
  cancelled_by: string | null;
  cancel_reason: string | null;
  no_show_marked_at: string | null;
  marketing_opt_in: number;
  created_at: string;
  updated_at: string;
};

function parseTags(json: string | null): string[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export function rowToReservation(
  row: ReservationRow,
  tableIds: string[]
): Reservation {
  return {
    id: row.id,
    reference: row.reference,
    contactId: row.contact_id,
    guestName: row.guest_name,
    guestPhone: row.guest_phone,
    guestEmail: row.guest_email,
    partySize: row.party_size,
    serviceDate: row.service_date,
    startTime: row.start_time,
    endTime: row.end_time,
    startsAtUtc: row.starts_at_utc,
    servicePeriodId: row.service_period_id,
    roomId: row.room_id,
    status: row.status as Reservation["status"],
    source: row.source as Reservation["source"],
    assignmentLocked: toBool(row.assignment_locked),
    occasion: row.occasion,
    allergies: row.allergies,
    guestNotes: row.guest_notes,
    staffNotes: row.staff_notes,
    tags: parseTags(row.tags_json),
    depositRequiredPence: row.deposit_required_pence,
    seatedAt: row.seated_at,
    finishedAt: row.finished_at,
    cancelledAt: row.cancelled_at,
    cancelReason: row.cancel_reason,
    noShowMarkedAt: row.no_show_marked_at,
    marketingOptIn: toBool(row.marketing_opt_in),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    tableIds,
  };
}

const statusPlaceholders = OCCUPYING_STATUSES.map(() => "?").join(", ");

/**
 * Occupancy for one service date: reservations and live holds, with their
 * tables.
 *
 * LEFT JOIN, not INNER. An unassigned reservation has no reservation_tables
 * rows, and an inner join would drop it entirely — yet it still consumes
 * pacing. The null table_id it produces is what makes that structural rather
 * than something a later edit has to remember.
 *
 * One round trip regardless of how many tables or slots the day has.
 */
export async function loadOccupancy(
  env: Env,
  locationId: string,
  serviceDate: string
): Promise<OccupancyRow[]> {
  const { results } = await env.DB.prepare(
    `SELECT r.id AS source_id, 'reservation' AS kind, rt.table_id AS table_id,
            r.start_time, r.end_time, r.party_size
     FROM reservations r
     LEFT JOIN reservation_tables rt ON rt.reservation_id = r.id
     WHERE r.location_id = ?1 AND r.organization_id = ?2
       AND r.service_date = ?3
       AND r.status IN (${statusPlaceholders})

     UNION ALL

     SELECT h.id AS source_id, 'hold' AS kind, ht.table_id AS table_id,
            h.start_time, h.end_time, h.party_size
     FROM reservation_holds h
     LEFT JOIN reservation_hold_tables ht ON ht.hold_id = h.id
     WHERE h.location_id = ?1 AND h.organization_id = ?2
       AND h.service_date = ?3
       AND h.consumed_at IS NULL
       AND h.expires_at > datetime('now')`
  )
    .bind(locationId, env.ORGANIZATION_ID, serviceDate, ...OCCUPYING_STATUSES)
    .all<{
      source_id: string;
      kind: "reservation" | "hold";
      table_id: string | null;
      start_time: string;
      end_time: string;
      party_size: number;
    }>();

  return (results ?? []).map((r) => ({
    sourceId: r.source_id,
    kind: r.kind,
    tableId: r.table_id,
    startTime: r.start_time,
    endTime: r.end_time,
    partySize: r.party_size,
  }));
}

export async function getReservation(
  env: Env,
  reservationId: string
): Promise<Reservation | null> {
  const row = await env.DB.prepare(
    `SELECT * FROM reservations WHERE id = ? AND organization_id = ?`
  )
    .bind(reservationId, env.ORGANIZATION_ID)
    .first<ReservationRow>();
  if (!row) return null;

  return rowToReservation(row, await reservationTableIds(env, reservationId));
}

export async function reservationTableIds(
  env: Env,
  reservationId: string
): Promise<string[]> {
  const { results } = await env.DB.prepare(
    `SELECT table_id FROM reservation_tables
     WHERE reservation_id = ? ORDER BY table_id ASC`
  )
    .bind(reservationId)
    .all<{ table_id: string }>();
  return (results ?? []).map((r) => r.table_id);
}

export async function listReservationEvents(
  env: Env,
  reservationId: string
): Promise<ReservationEvent[]> {
  const { results } = await env.DB.prepare(
    // rowid, not id, as the tie-break: created_at is second-resolution, so a
    // booking seated and finished in the same second collides, and ordering by
    // a random UUID then shuffles the history on screen. rowid is insert order.
    `SELECT id, type, actor, data_json, created_at
     FROM reservation_events
     WHERE reservation_id = ? AND organization_id = ?
     ORDER BY created_at ASC, rowid ASC`
  )
    .bind(reservationId, env.ORGANIZATION_ID)
    .all<{
      id: string;
      type: string;
      actor: string;
      data_json: string | null;
      created_at: string;
    }>();

  return (results ?? []).map((r) => ({
    id: r.id,
    type: r.type,
    actor: r.actor,
    data: r.data_json ? safeParse(r.data_json) : null,
    createdAt: r.created_at,
  }));
}

function safeParse(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

/** Audit row for the reservation's own log. Built, not run — callers batch it
 *  alongside the write it describes so the two cannot diverge. */
export function reservationEventStatement(
  env: Env,
  reservationId: string,
  type: string,
  actor: string,
  data?: unknown
): D1PreparedStatement {
  return env.DB.prepare(
    `INSERT INTO reservation_events (id, organization_id, reservation_id, type, actor, data_json)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(
    crypto.randomUUID(),
    env.ORGANIZATION_ID,
    reservationId,
    type,
    actor,
    data === undefined ? null : JSON.stringify(data)
  );
}

/**
 * Tables occupied by other reservations overlapping this window.
 *
 * `excludeReservationId` matters: a reservation being modified always overlaps
 * itself, and forgetting it makes every edit look like a conflict.
 */
export async function conflictingTableIds(
  env: Env,
  locationId: string,
  serviceDate: string,
  startTime: string,
  endTime: string,
  tableIds: string[],
  excludeReservationId: string | null
): Promise<string[]> {
  if (tableIds.length === 0) return [];
  const tablePlaceholders = tableIds.map(() => "?").join(", ");

  const { results } = await env.DB.prepare(
    `SELECT DISTINCT rt.table_id
     FROM reservation_tables rt
     JOIN reservations r ON r.id = rt.reservation_id
     WHERE r.location_id = ? AND r.organization_id = ?
       AND r.service_date = ?
       AND r.status IN (${statusPlaceholders})
       AND rt.table_id IN (${tablePlaceholders})
       AND NOT (r.end_time <= ? OR r.start_time >= ?)
       AND (? IS NULL OR r.id != ?)`
  )
    .bind(
      locationId,
      env.ORGANIZATION_ID,
      serviceDate,
      ...OCCUPYING_STATUSES,
      ...tableIds,
      startTime,
      endTime,
      excludeReservationId,
      excludeReservationId
    )
    .all<{ table_id: string }>();

  return (results ?? []).map((r) => r.table_id);
}
