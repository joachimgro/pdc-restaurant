import type { Env } from "../../../env";
import { resolveGuest } from "../guests";

export type WaitlistKind = "walk_in" | "date_waitlist";

export type WaitlistStatus =
  | "waiting"
  | "notified"
  | "seated"
  | "converted"
  | "removed";

export type WaitlistEntryRow = {
  id: string;
  organization_id: string;
  location_id: string;
  contact_id: string | null;
  guest_name: string;
  guest_phone: string | null;
  guest_email: string | null;
  party_size: number;
  kind: WaitlistKind;
  service_date: string;
  requested_from: string | null;
  requested_to: string | null;
  status: WaitlistStatus;
  quoted_wait_min: number | null;
  priority: number;
  joined_at: string;
  notified_at: string | null;
  notify_expires_at: string | null;
  notify_count: number;
  seated_at: string | null;
  removed_at: string | null;
  removed_reason: string | null;
  reservation_id: string | null;
  notes: string | null;
  created_by_staff_id: string | null;
  created_at: string;
  updated_at: string;
};

export type CreateWaitlistEntryParams = {
  locationId: string;
  guestName: string;
  guestPhone?: string | null;
  guestEmail?: string | null;
  partySize: number;
  kind: WaitlistKind;
  serviceDate: string;
  requestedFrom?: string | null;
  requestedTo?: string | null;
  notes?: string | null;
  priority?: number;
  createdByStaffId?: string | null;
};

const ACTIVE_STATUSES: WaitlistStatus[] = ["waiting", "notified"];

export async function createEntry(
  env: Env,
  params: CreateWaitlistEntryParams
): Promise<WaitlistEntryRow> {
  const { contactId } = await resolveGuest(env, {
    name: params.guestName,
    email: params.guestEmail ?? null,
    phone: params.guestPhone ?? null,
  });

  const id = crypto.randomUUID();
  const email = params.guestEmail?.trim().toLowerCase() || null;
  const phone = params.guestPhone?.trim() || null;

  await env.DB.prepare(
    `INSERT INTO waitlist_entries (
       id, organization_id, location_id, contact_id, guest_name, guest_phone,
       guest_email, party_size, kind, service_date, requested_from, requested_to,
       status, priority, notes, created_by_staff_id
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'waiting', ?, ?, ?)`
  )
    .bind(
      id,
      env.ORGANIZATION_ID,
      params.locationId,
      contactId,
      params.guestName.trim(),
      phone,
      email,
      params.partySize,
      params.kind,
      params.serviceDate,
      params.requestedFrom ?? null,
      params.requestedTo ?? null,
      params.priority ?? 100,
      params.notes ?? null,
      params.createdByStaffId ?? null
    )
    .run();

  return (await getEntry(env, id))!;
}

export async function getEntry(
  env: Env,
  id: string
): Promise<WaitlistEntryRow | null> {
  return env.DB.prepare(
    `SELECT * FROM waitlist_entries WHERE id = ? AND organization_id = ?`
  )
    .bind(id, env.ORGANIZATION_ID)
    .first<WaitlistEntryRow>();
}

export type WaitlistEntryWithPosition = WaitlistEntryRow & { position: number };

/**
 * Active queue for one service date. Position is computed at read time —
 * never stored.
 */
export async function listForDate(
  env: Env,
  locationId: string,
  serviceDate: string
): Promise<WaitlistEntryWithPosition[]> {
  const placeholders = ACTIVE_STATUSES.map(() => "?").join(", ");
  const { results } = await env.DB.prepare(
    `SELECT * FROM waitlist_entries
     WHERE organization_id = ? AND location_id = ? AND service_date = ?
       AND status IN (${placeholders})
     ORDER BY priority ASC, joined_at ASC`
  )
    .bind(env.ORGANIZATION_ID, locationId, serviceDate, ...ACTIVE_STATUSES)
    .all<WaitlistEntryRow>();

  return (results ?? []).map((row, index) => ({
    ...row,
    position: index + 1,
  }));
}

const NOTIFY_TTL_MINUTES = 10;

export async function notifyEntry(
  env: Env,
  id: string
): Promise<WaitlistEntryRow | null> {
  const existing = await getEntry(env, id);
  if (!existing || !ACTIVE_STATUSES.includes(existing.status)) return null;

  await env.DB.prepare(
    `UPDATE waitlist_entries
     SET status = 'notified',
         notified_at = datetime('now'),
         notify_expires_at = datetime('now', '+${NOTIFY_TTL_MINUTES} minutes'),
         notify_count = notify_count + 1,
         updated_at = datetime('now')
     WHERE id = ? AND organization_id = ?`
  )
    .bind(id, env.ORGANIZATION_ID)
    .run();

  return getEntry(env, id);
}

export async function convertToReservation(
  env: Env,
  id: string,
  reservationId: string
): Promise<WaitlistEntryRow | null> {
  const existing = await getEntry(env, id);
  if (!existing || existing.status === "removed" || existing.status === "converted") {
    return null;
  }

  await env.DB.prepare(
    `UPDATE waitlist_entries
     SET status = 'converted',
         reservation_id = ?,
         seated_at = COALESCE(seated_at, datetime('now')),
         updated_at = datetime('now')
     WHERE id = ? AND organization_id = ?`
  )
    .bind(reservationId, id, env.ORGANIZATION_ID)
    .run();

  return getEntry(env, id);
}

export async function removeEntry(
  env: Env,
  id: string,
  reason: string
): Promise<WaitlistEntryRow | null> {
  const existing = await getEntry(env, id);
  if (!existing || existing.status === "removed") return null;

  await env.DB.prepare(
    `UPDATE waitlist_entries
     SET status = 'removed',
         removed_at = datetime('now'),
         removed_reason = ?,
         updated_at = datetime('now')
     WHERE id = ? AND organization_id = ?`
  )
    .bind(reason.trim() || null, id, env.ORGANIZATION_ID)
    .run();

  return getEntry(env, id);
}

export function serializeWaitlistEntry(
  row: WaitlistEntryRow,
  position?: number
) {
  return {
    id: row.id,
    locationId: row.location_id,
    contactId: row.contact_id,
    guestName: row.guest_name,
    guestPhone: row.guest_phone,
    guestEmail: row.guest_email,
    partySize: row.party_size,
    kind: row.kind,
    serviceDate: row.service_date,
    requestedFrom: row.requested_from,
    requestedTo: row.requested_to,
    status: row.status,
    quotedWaitMin: row.quoted_wait_min,
    priority: row.priority,
    joinedAt: row.joined_at,
    notifiedAt: row.notified_at,
    notifyExpiresAt: row.notify_expires_at,
    notifyCount: row.notify_count,
    seatedAt: row.seated_at,
    removedAt: row.removed_at,
    removedReason: row.removed_reason,
    reservationId: row.reservation_id,
    notes: row.notes,
    createdByStaffId: row.created_by_staff_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(position !== undefined ? { position } : {}),
  };
}
