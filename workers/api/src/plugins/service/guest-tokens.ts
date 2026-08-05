import type { Env } from "../../env";
import { hashToken, randomToken } from "../../auth/crypto";
import { getReservation } from "./db/reservations";
import type { Reservation } from "@lead-intake/shared-types";
import { addDays } from "./time";

export type MintGuestTokenParams = {
  reservationId: string;
  scope?: "manage_reservation";
  /** Absolute expiry override; otherwise service_date+1 or 90 days. */
  expiresAt?: string;
};

export async function mintGuestToken(
  env: Env,
  params: MintGuestTokenParams
): Promise<{ rawToken: string; tokenId: string; expiresAt: string }> {
  const reservation = await getReservation(env, params.reservationId);
  if (!reservation) {
    throw new Error("mintGuestToken: reservation not found");
  }

  const rawToken = randomToken();
  const tokenHash = await hashToken(rawToken);
  const tokenId = crypto.randomUUID();
  const expiresAt =
    params.expiresAt ?? defaultExpiry(reservation.serviceDate);

  await env.DB.prepare(
    `INSERT INTO guest_access_tokens (
       id, organization_id, reservation_id, token_hash, scope, expires_at
     ) VALUES (?, ?, ?, ?, ?, ?)`
  )
    .bind(
      tokenId,
      env.ORGANIZATION_ID,
      params.reservationId,
      tokenHash,
      params.scope ?? "manage_reservation",
      expiresAt
    )
    .run();

  return { rawToken, tokenId, expiresAt };
}

export type ResolvedGuestToken = {
  tokenId: string;
  reservation: Reservation;
  scope: string;
};

export async function resolveGuestToken(
  env: Env,
  rawToken: string
): Promise<ResolvedGuestToken | null> {
  if (!rawToken?.trim()) return null;
  const tokenHash = await hashToken(rawToken.trim());

  const row = await env.DB.prepare(
    `SELECT id, reservation_id, scope, expires_at, revoked_at
     FROM guest_access_tokens
     WHERE token_hash = ? AND organization_id = ?`
  )
    .bind(tokenHash, env.ORGANIZATION_ID)
    .first<{
      id: string;
      reservation_id: string | null;
      scope: string;
      expires_at: string;
      revoked_at: string | null;
    }>();

  if (!row || !row.reservation_id) return null;
  if (row.revoked_at) return null;
  // expires_at stored as ISO or SQLite datetime — lexical compare works for ISO.
  if (row.expires_at < new Date().toISOString()) return null;

  const reservation = await getReservation(env, row.reservation_id);
  if (!reservation) return null;

  await env.DB.prepare(
    `UPDATE guest_access_tokens
     SET uses = uses + 1, last_used_at = datetime('now')
     WHERE id = ?`
  )
    .bind(row.id)
    .run();

  return { tokenId: row.id, reservation, scope: row.scope };
}

export async function revokeGuestTokensForReservation(
  env: Env,
  reservationId: string
): Promise<void> {
  await env.DB.prepare(
    `UPDATE guest_access_tokens
     SET revoked_at = datetime('now')
     WHERE organization_id = ? AND reservation_id = ?
       AND revoked_at IS NULL`
  )
    .bind(env.ORGANIZATION_ID, reservationId)
    .run();
}

function defaultExpiry(serviceDate: string): string {
  const afterService = addDays(serviceDate, 1) + "T23:59:59.000Z";
  const in90 = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();
  return afterService < in90 ? afterService : in90;
}
