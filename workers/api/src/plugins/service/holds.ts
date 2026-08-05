import { OCCUPYING_STATUSES } from "@lead-intake/shared-types";
import type { Env } from "../../env";

/**
 * Reservation holds — the concurrency mechanism (spec §18).
 *
 * The hold insert is a single conditional statement: the conflict subqueries
 * and the write are evaluated atomically by SQLite, so two racing requests
 * cannot both pass the check. D1 is single-primary, every write serialises
 * through one writer, and there is no gap between "is the table free" and
 * "take it" for another request to slip into. That property lives entirely in
 * this file — nothing else may write reservation_holds rows.
 *
 * meta.changes on the insert is the verdict: 1 means the hold was taken,
 * 0 means someone else won the race and the caller returns SLOT_TAKEN.
 *
 * All time comparisons are lexical on zero-padded "HH:MM" strings, which
 * TimeStringSchema enforces at the API boundary. "25:30" late-bar overflow
 * still orders correctly. expires_at is generated inside SQL with
 * datetime('now', '+N seconds') so every expiry comparison happens in
 * SQLite's own datetime format — binding a JS ISO string here would compare
 * 'T' against ' ' and quietly break expiry.
 */

export type CreateHoldParams = {
  holdId: string;
  locationId: string;
  serviceDate: string;
  startTime: string;
  endTime: string;
  partySize: number;
  clientTokenHash: string;
  ttlSeconds: number;
  /** Every table the booking needs — both members for a combination. */
  tableIds: string[];
};

export type CreateHoldResult =
  | { ok: true; holdId: string }
  | { ok: false; code: "SLOT_TAKEN" };

/**
 * Overlap test in both subqueries: NOT (existing.end <= start OR
 * existing.start >= end). Adjacency is not conflict — a party leaving at
 * 19:00 frees the table for a 19:00 booking.
 */
export async function createHold(
  env: Env,
  params: CreateHoldParams
): Promise<CreateHoldResult> {
  const {
    holdId,
    locationId,
    serviceDate,
    startTime,
    endTime,
    partySize,
    clientTokenHash,
    ttlSeconds,
    tableIds,
  } = params;

  if (tableIds.length === 0) {
    throw new Error("createHold requires at least one table id");
  }
  if (!Number.isInteger(ttlSeconds) || ttlSeconds <= 0) {
    // A bad TTL would make datetime() return NULL and trip the NOT NULL
    // constraint mid-batch; fail loudly here instead.
    throw new Error(`Invalid hold TTL: ${ttlSeconds}`);
  }

  // Params ?1-?10 match the spec's numbering; the occupying statuses follow
  // from ?11. Built from OCCUPYING_STATUSES — never inlined.
  const statusPlaceholders = OCCUPYING_STATUSES.map(
    (_, i) => `?${11 + i}`
  ).join(", ");

  const insertHold = env.DB.prepare(
    `INSERT INTO reservation_holds (id, organization_id, location_id, service_date,
                                    start_time, end_time, party_size, client_token_hash,
                                    expires_at, created_at)
     SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, datetime('now', ?9), datetime('now')
     WHERE NOT EXISTS (
       SELECT 1 FROM reservation_tables rt
       JOIN reservations r ON r.id = rt.reservation_id
       WHERE rt.table_id IN (SELECT value FROM json_each(?10))
         AND r.organization_id = ?2
         AND r.location_id = ?3 AND r.service_date = ?4
         AND r.status IN (${statusPlaceholders})
         AND NOT (r.end_time <= ?5 OR r.start_time >= ?6)
     )
     AND NOT EXISTS (
       SELECT 1 FROM reservation_hold_tables ht
       JOIN reservation_holds h ON h.id = ht.hold_id
       WHERE ht.table_id IN (SELECT value FROM json_each(?10))
         AND h.organization_id = ?2
         AND h.location_id = ?3 AND h.service_date = ?4
         AND h.consumed_at IS NULL AND h.expires_at > datetime('now')
         AND NOT (h.end_time <= ?5 OR h.start_time >= ?6)
     )`
  ).bind(
    holdId,
    env.ORGANIZATION_ID,
    locationId,
    serviceDate,
    startTime,
    endTime,
    partySize,
    clientTokenHash,
    `+${ttlSeconds} seconds`,
    JSON.stringify(tableIds),
    ...OCCUPYING_STATUSES
  );

  // Member rows are conditional on the hold row existing, so a lost race
  // leaves nothing behind — no orphan hold_tables rows to make a table look
  // busy under a hold that was never taken.
  const insertMembers = tableIds.map((tableId) =>
    env.DB.prepare(
      `INSERT INTO reservation_hold_tables (hold_id, table_id)
       SELECT ?1, ?2
       WHERE EXISTS (SELECT 1 FROM reservation_holds WHERE id = ?1)`
    ).bind(holdId, tableId)
  );

  // One batch: an implicit transaction, all-or-nothing, statements applied in
  // order so the member inserts see the hold row (or its absence).
  const results = await env.DB.batch([insertHold, ...insertMembers]);

  if (results[0].meta.changes !== 1) {
    return { ok: false, code: "SLOT_TAKEN" };
  }
  return { ok: true, holdId };
}

/**
 * Consume a live hold, tying it to the reservation it became.
 *
 * The guards are inside the UPDATE for the same reason the hold insert is
 * conditional: checking expiry in JS and then writing would leave a gap.
 * false means the hold was already consumed or expired — HOLD_EXPIRED to the
 * caller.
 */
export async function consumeHold(
  env: Env,
  holdId: string,
  reservationId: string
): Promise<boolean> {
  const result = await env.DB.prepare(
    `UPDATE reservation_holds
     SET consumed_at = datetime('now'), reservation_id = ?
     WHERE id = ? AND organization_id = ?
       AND consumed_at IS NULL
       AND expires_at > datetime('now')`
  )
    .bind(reservationId, holdId, env.ORGANIZATION_ID)
    .run();

  return result.meta.changes === 1;
}

/** Table ids attached to a hold, in insert order. */
export async function holdTableIds(
  env: Env,
  holdId: string
): Promise<string[]> {
  const { results } = await env.DB.prepare(
    `SELECT ht.table_id FROM reservation_hold_tables ht
     JOIN reservation_holds h ON h.id = ht.hold_id
     WHERE ht.hold_id = ? AND h.organization_id = ?`
  )
    .bind(holdId, env.ORGANIZATION_ID)
    .all<{ table_id: string }>();

  return (results ?? []).map((r) => r.table_id);
}
