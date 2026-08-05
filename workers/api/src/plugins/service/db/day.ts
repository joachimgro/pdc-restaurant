import type { Reservation } from "@lead-intake/shared-types";
import type { Env } from "../../../env";
import { rowToReservation, type ReservationRow } from "./reservations";

/**
 * Every reservation for one service date, in every status.
 *
 * The console shows cancellations and no-shows as well as live bookings, so
 * this deliberately does not filter by status — OCCUPYING_STATUSES governs
 * availability, not what a manager is allowed to look at.
 *
 * Two queries regardless of how many reservations the day holds: the rows,
 * then all their table links in one pass. Fetching links per reservation
 * would be 80 round trips on a full Saturday.
 */
export async function listReservationsForDate(
  env: Env,
  locationId: string,
  serviceDate: string
): Promise<Reservation[]> {
  const { results: rows } = await env.DB.prepare(
    `SELECT * FROM reservations
     WHERE location_id = ? AND organization_id = ? AND service_date = ?
     ORDER BY start_time ASC, created_at ASC`
  )
    .bind(locationId, env.ORGANIZATION_ID, serviceDate)
    .all<ReservationRow>();

  const reservations = rows ?? [];
  if (reservations.length === 0) return [];

  const { results: links } = await env.DB.prepare(
    `SELECT rt.reservation_id, rt.table_id
     FROM reservation_tables rt
     JOIN reservations r ON r.id = rt.reservation_id
     WHERE r.location_id = ? AND r.organization_id = ? AND r.service_date = ?
     ORDER BY rt.table_id ASC`
  )
    .bind(locationId, env.ORGANIZATION_ID, serviceDate)
    .all<{ reservation_id: string; table_id: string }>();

  const tablesByReservation = new Map<string, string[]>();
  for (const link of links ?? []) {
    const list = tablesByReservation.get(link.reservation_id);
    if (list) list.push(link.table_id);
    else tablesByReservation.set(link.reservation_id, [link.table_id]);
  }

  return reservations.map((row) =>
    rowToReservation(row, tablesByReservation.get(row.id) ?? [])
  );
}
