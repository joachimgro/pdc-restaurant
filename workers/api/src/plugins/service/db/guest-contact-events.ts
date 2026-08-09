import { insertDomainEvent } from "../../../db/events";
import type { Env } from "../../../env";

/**
 * Tell staff UIs to refetch guest contact timeline / guests list.
 * Payload stays id-only (no message body on the SSE bus).
 */
export async function emitGuestContactUpdated(
  env: Env,
  params: {
    reservationId: string;
    serviceDate: string;
    reason?: string;
  }
): Promise<void> {
  await insertDomainEvent(env.DB, env.ORGANIZATION_ID, {
    type: "reservation.updated",
    payload: {
      reservationId: params.reservationId,
      serviceDate: params.serviceDate,
      patch: {
        guestContact: true,
        reason: params.reason ?? "updated",
      },
    },
  });
}

export async function serviceDateForReservation(
  env: Env,
  reservationId: string
): Promise<string | null> {
  const row = await env.DB.prepare(
    `SELECT service_date FROM reservations
     WHERE id = ? AND organization_id = ?`
  )
    .bind(reservationId, env.ORGANIZATION_ID)
    .first<{ service_date: string }>();
  return row?.service_date ?? null;
}
