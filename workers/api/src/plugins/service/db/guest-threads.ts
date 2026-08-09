import type { Env } from "../../../env";

export type GuestThreadRow = {
  id: string;
  organization_id: string;
  location_id: string;
  reservation_id: string | null;
  guest_name: string;
  guest_email: string | null;
  guest_phone: string | null;
  preview: string | null;
  last_message_at: string | null;
  flagged_at: string | null;
  flag_reason: string | null;
  muted_at: string | null;
  created_at: string;
  updated_at: string;
};

export type GuestMessageRow = {
  id: string;
  thread_id: string;
  organization_id: string;
  direction: string;
  channel: string;
  body: string;
  subject: string | null;
  notification_id: string | null;
  staff_user_id: string | null;
  status: string;
  created_at: string;
  updated_at: string;
};

export type UpsertGuestThreadParams = {
  locationId: string;
  reservationId: string;
  guestName: string;
  guestEmail: string | null;
  guestPhone: string | null;
};

/**
 * Find or create a guest thread for a reservation. Prefer email unique key;
 * fall back to reservation_id match. Never touches leads.
 */
export async function upsertGuestThread(
  env: Env,
  params: UpsertGuestThreadParams
): Promise<GuestThreadRow> {
  const email = params.guestEmail?.trim().toLowerCase() || null;
  const phone = params.guestPhone?.trim() || null;

  if (email) {
    const byEmail = await env.DB.prepare(
      `SELECT * FROM guest_threads
       WHERE organization_id = ? AND guest_email = ?`
    )
      .bind(env.ORGANIZATION_ID, email)
      .first<GuestThreadRow>();
    if (byEmail) {
      await env.DB.prepare(
        `UPDATE guest_threads
         SET reservation_id = COALESCE(?, reservation_id),
             guest_name = ?,
             guest_phone = COALESCE(?, guest_phone),
             location_id = ?,
             updated_at = datetime('now')
         WHERE id = ? AND organization_id = ?`
      )
        .bind(
          params.reservationId,
          params.guestName,
          phone,
          params.locationId,
          byEmail.id,
          env.ORGANIZATION_ID
        )
        .run();
      return (await getGuestThread(env, byEmail.id))!;
    }
  }

  const byRes = await env.DB.prepare(
    `SELECT * FROM guest_threads
     WHERE organization_id = ? AND reservation_id = ?`
  )
    .bind(env.ORGANIZATION_ID, params.reservationId)
    .first<GuestThreadRow>();
  if (byRes) {
    await env.DB.prepare(
      `UPDATE guest_threads
       SET guest_name = ?, guest_email = COALESCE(?, guest_email),
           guest_phone = COALESCE(?, guest_phone),
           updated_at = datetime('now')
       WHERE id = ? AND organization_id = ?`
    )
      .bind(
        params.guestName,
        email,
        phone,
        byRes.id,
        env.ORGANIZATION_ID
      )
      .run();
    return (await getGuestThread(env, byRes.id))!;
  }

  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO guest_threads (
       id, organization_id, location_id, reservation_id,
       guest_name, guest_email, guest_phone, last_message_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`
  )
    .bind(
      id,
      env.ORGANIZATION_ID,
      params.locationId,
      params.reservationId,
      params.guestName,
      email,
      phone
    )
    .run();

  return (await getGuestThread(env, id))!;
}

export async function getGuestThread(
  env: Env,
  threadId: string
): Promise<GuestThreadRow | null> {
  return env.DB.prepare(
    `SELECT * FROM guest_threads WHERE id = ? AND organization_id = ?`
  )
    .bind(threadId, env.ORGANIZATION_ID)
    .first<GuestThreadRow>();
}

export async function getGuestThreadByReservation(
  env: Env,
  reservationId: string
): Promise<GuestThreadRow | null> {
  return env.DB.prepare(
    `SELECT * FROM guest_threads
     WHERE organization_id = ? AND reservation_id = ?`
  )
    .bind(env.ORGANIZATION_ID, reservationId)
    .first<GuestThreadRow>();
}

export type AppendGuestMessageParams = {
  threadId: string;
  direction: "outbound" | "inbound" | "system";
  channel: "email" | "sms";
  body: string;
  subject?: string | null;
  notificationId?: string | null;
  staffUserId?: string | null;
  status?: "queued" | "sent" | "failed" | "scheduled";
};

export async function appendGuestMessage(
  env: Env,
  params: AppendGuestMessageParams
): Promise<GuestMessageRow> {
  if (params.notificationId) {
    const existing = await env.DB.prepare(
      `SELECT * FROM guest_messages
       WHERE organization_id = ? AND notification_id = ?`
    )
      .bind(env.ORGANIZATION_ID, params.notificationId)
      .first<GuestMessageRow>();
    if (existing) return existing;
  }

  const id = crypto.randomUUID();
  const status = params.status ?? "queued";
  const preview = params.body.slice(0, 120);

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO guest_messages (
         id, thread_id, organization_id, direction, channel, body, subject,
         notification_id, staff_user_id, status
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      id,
      params.threadId,
      env.ORGANIZATION_ID,
      params.direction,
      params.channel,
      params.body,
      params.subject ?? null,
      params.notificationId ?? null,
      params.staffUserId ?? null,
      status
    ),
    env.DB.prepare(
      `UPDATE guest_threads
       SET preview = ?, last_message_at = datetime('now'), updated_at = datetime('now')
       WHERE id = ? AND organization_id = ?`
    ).bind(preview, params.threadId, env.ORGANIZATION_ID),
  ]);

  return (await env.DB.prepare(
    `SELECT * FROM guest_messages WHERE id = ? AND organization_id = ?`
  )
    .bind(id, env.ORGANIZATION_ID)
    .first<GuestMessageRow>())!;
}

export async function listGuestMessages(
  env: Env,
  threadId: string
): Promise<GuestMessageRow[]> {
  const { results } = await env.DB.prepare(
    `SELECT * FROM guest_messages
     WHERE thread_id = ? AND organization_id = ?
     ORDER BY created_at ASC, rowid ASC`
  )
    .bind(threadId, env.ORGANIZATION_ID)
    .all<GuestMessageRow>();
  return results ?? [];
}

export async function listGuestThreads(
  env: Env,
  opts: { limit?: number; includeMuted?: boolean } = {}
): Promise<GuestThreadRow[]> {
  const limit = opts.limit ?? 50;
  const includeMuted = opts.includeMuted ?? false;
  const mutedFilter = includeMuted ? "" : "AND muted_at IS NULL";

  const { results } = await env.DB.prepare(
    `SELECT * FROM guest_threads
     WHERE organization_id = ? ${mutedFilter}
     ORDER BY
       CASE WHEN flagged_at IS NOT NULL THEN 0 ELSE 1 END,
       COALESCE(last_message_at, created_at) DESC
     LIMIT ?`
  )
    .bind(env.ORGANIZATION_ID, limit)
    .all<GuestThreadRow>();
  return results ?? [];
}

export async function flagThread(
  env: Env,
  threadId: string,
  reason?: string | null
): Promise<GuestThreadRow | null> {
  const existing = await getGuestThread(env, threadId);
  if (!existing) return null;

  await env.DB.prepare(
    `UPDATE guest_threads
     SET flagged_at = datetime('now'),
         flag_reason = ?,
         updated_at = datetime('now')
     WHERE id = ? AND organization_id = ?`
  )
    .bind(reason?.trim() || null, threadId, env.ORGANIZATION_ID)
    .run();

  return getGuestThread(env, threadId);
}

export async function muteThread(
  env: Env,
  threadId: string
): Promise<GuestThreadRow | null> {
  const existing = await getGuestThread(env, threadId);
  if (!existing) return null;

  await env.DB.prepare(
    `UPDATE guest_threads
     SET muted_at = datetime('now'),
         updated_at = datetime('now')
     WHERE id = ? AND organization_id = ?`
  )
    .bind(threadId, env.ORGANIZATION_ID)
    .run();

  return getGuestThread(env, threadId);
}

export async function unmuteThread(
  env: Env,
  threadId: string
): Promise<GuestThreadRow | null> {
  const existing = await getGuestThread(env, threadId);
  if (!existing) return null;

  await env.DB.prepare(
    `UPDATE guest_threads
     SET muted_at = NULL,
         updated_at = datetime('now')
     WHERE id = ? AND organization_id = ?`
  )
    .bind(threadId, env.ORGANIZATION_ID)
    .run();

  return getGuestThread(env, threadId);
}

export type NotificationTimelineRow = {
  id: string;
  channel: string;
  template: string;
  to_address: string;
  status: string;
  scheduled_for: string | null;
  sent_at: string | null;
  error_text: string | null;
  created_at: string;
};

export async function listNotificationsForReservation(
  env: Env,
  reservationId: string
): Promise<NotificationTimelineRow[]> {
  const { results } = await env.DB.prepare(
    `SELECT id, channel, template, to_address, status, scheduled_for, sent_at,
            error_text, created_at
     FROM notifications
     WHERE organization_id = ? AND reservation_id = ?
     ORDER BY COALESCE(sent_at, scheduled_for, created_at) ASC`
  )
    .bind(env.ORGANIZATION_ID, reservationId)
    .all<NotificationTimelineRow>();
  return results ?? [];
}

/** Human label for a notification template in the staff timeline. */
export function notificationLabel(template: string, channel: string): string {
  const map: Record<string, string> = {
    reservation_confirmed: "Confirmation",
    reservation_reminder: "Reminder",
    reservation_reminder_sms: "Reminder SMS",
    reservation_changed: "Booking updated",
    reservation_cancelled: "Cancellation",
    review_request: "Review request",
  };
  const base = map[template] ?? template.replace(/_/g, " ");
  return channel === "sms" ? `${base} (SMS)` : `${base} email`;
}
