import type {
  AvailabilityException,
  AvailabilityExceptionInput,
} from "@lead-intake/shared-types";
import type { Env } from "../../../env";
import type { AvailabilityExceptionRow } from "../types";

function rowToException(row: AvailabilityExceptionRow): AvailabilityException {
  return {
    id: row.id,
    serviceDate: row.service_date,
    kind: row.kind as AvailabilityException["kind"],
    startTime: row.start_time,
    endTime: row.end_time,
    roomId: row.room_id,
    tableId: row.table_id,
    overrideLastSeating: row.override_last_seating,
    note: row.note,
  };
}

/** Closures and blocks for a date range, inclusive of both ends. */
export async function listExceptions(
  env: Env,
  locationId: string,
  from: string,
  to: string
): Promise<AvailabilityException[]> {
  const { results } = await env.DB.prepare(
    `SELECT * FROM availability_exceptions
     WHERE location_id = ? AND organization_id = ?
       AND service_date >= ? AND service_date <= ?
     ORDER BY service_date ASC, start_time ASC, id ASC`
  )
    .bind(locationId, env.ORGANIZATION_ID, from, to)
    .all<AvailabilityExceptionRow>();

  return (results ?? []).map(rowToException);
}

export async function createException(
  env: Env,
  locationId: string,
  input: AvailabilityExceptionInput,
  createdByStaffId: string | null
): Promise<AvailabilityException> {
  const id = crypto.randomUUID();

  await env.DB.prepare(
    `INSERT INTO availability_exceptions (
       id, organization_id, location_id, service_date, kind, start_time,
       end_time, room_id, table_id, override_last_seating, note,
       created_by_staff_id
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      id,
      env.ORGANIZATION_ID,
      locationId,
      input.serviceDate,
      input.kind,
      input.startTime,
      input.endTime,
      input.roomId,
      input.tableId,
      input.overrideLastSeating,
      input.note,
      createdByStaffId
    )
    .run();

  return { id, ...input };
}

export async function deleteException(
  env: Env,
  exceptionId: string
): Promise<boolean> {
  const result = await env.DB.prepare(
    `DELETE FROM availability_exceptions
     WHERE id = ? AND organization_id = ?`
  )
    .bind(exceptionId, env.ORGANIZATION_ID)
    .run();

  return (result.meta.changes ?? 0) > 0;
}
