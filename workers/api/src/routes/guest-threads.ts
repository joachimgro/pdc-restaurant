import { z } from "zod";
import { jsonResponse } from "../cors";
import { getStaffSession, type StaffSession } from "../auth/session";
import { insertDomainEvent } from "../db/events";
import { emailLayout, escapeHtml } from "../email/layout";
import { sendBookingEmail } from "../email/send";
import type { Env } from "../env";
import { getReservation } from "../plugins/service/db/reservations";
import {
  getOrCreateProfile,
} from "../plugins/service/db/guest-profiles";
import {
  appendGuestMessage,
  flagThread,
  getGuestThreadByReservation,
  listGuestMessages,
  listGuestThreads,
  listNotificationsForReservation,
  muteThread,
  notificationLabel,
  unmuteThread,
  upsertGuestThread,
  type GuestMessageRow,
  type GuestThreadRow,
  type NotificationTimelineRow,
} from "../plugins/service/db/guest-threads";
import { getVenueSettings } from "../plugins/service/db/venue";

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

function serializeThread(row: GuestThreadRow) {
  return {
    id: row.id,
    locationId: row.location_id,
    reservationId: row.reservation_id,
    guestName: row.guest_name,
    guestEmail: row.guest_email,
    guestPhone: row.guest_phone,
    preview: row.preview,
    lastMessageAt: row.last_message_at,
    flaggedAt: row.flagged_at,
    flagReason: row.flag_reason,
    mutedAt: row.muted_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function serializeMessage(row: GuestMessageRow) {
  return {
    id: row.id,
    threadId: row.thread_id,
    direction: row.direction,
    channel: row.channel,
    body: row.body,
    subject: row.subject,
    notificationId: row.notification_id,
    staffUserId: row.staff_user_id,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function serializeNotification(row: NotificationTimelineRow) {
  return {
    id: row.id,
    channel: row.channel,
    template: row.template,
    toAddress: row.to_address,
    status: row.status,
    scheduledFor: row.scheduled_for,
    sentAt: row.sent_at,
    errorText: row.error_text,
    createdAt: row.created_at,
    label: notificationLabel(row.template, row.channel),
  };
}

export type ContactTimelineItem =
  | {
      kind: "notification";
      id: string;
      at: string;
      channel: string;
      status: string;
      label: string;
      toAddress: string;
      errorText: string | null;
    }
  | {
      kind: "message";
      id: string;
      at: string;
      direction: string;
      channel: string;
      status: string;
      body: string;
      subject: string | null;
      staffUserId: string | null;
    };

function buildTimeline(
  notifications: NotificationTimelineRow[],
  messages: GuestMessageRow[]
): ContactTimelineItem[] {
  const items: ContactTimelineItem[] = [];

  for (const n of notifications) {
    // Staff replies + guest inbound are rendered from guest_messages (full body).
    if (n.template === "staff_reply" || n.template === "guest_inbound") continue;
    items.push({
      kind: "notification",
      id: n.id,
      at: n.sent_at ?? n.scheduled_for ?? n.created_at,
      channel: n.channel,
      status: n.status,
      label: notificationLabel(n.template, n.channel),
      toAddress: n.to_address,
      errorText: n.error_text,
    });
  }

  for (const m of messages) {
    // System snapshots of booking notifications — avoid duplicate rows.
    if (m.direction === "system" && m.notification_id) continue;
    items.push({
      kind: "message",
      id: m.id,
      at: m.created_at,
      direction: m.direction,
      channel: m.channel,
      status: m.status,
      body: m.body,
      subject: m.subject,
      staffUserId: m.staff_user_id,
    });
  }

  items.sort((a, b) => a.at.localeCompare(b.at));
  return items;
}

async function ensureThreadForReservation(env: Env, reservationId: string) {
  const reservation = await getReservation(env, reservationId);
  if (!reservation) return null;

  const loc = await env.DB.prepare(
    `SELECT location_id FROM reservations WHERE id = ? AND organization_id = ?`
  )
    .bind(reservationId, env.ORGANIZATION_ID)
    .first<{ location_id: string }>();
  if (!loc) return null;

  const thread = await upsertGuestThread(env, {
    locationId: loc.location_id,
    reservationId: reservation.id,
    guestName: reservation.guestName,
    guestEmail: reservation.guestEmail,
    guestPhone: reservation.guestPhone,
  });

  return { reservation, thread, locationId: loc.location_id };
}

/** GET /service/reservations/:id/contact */
export async function handleGetReservationContact(
  request: Request,
  env: Env,
  reservationId: string
): Promise<Response> {
  const session = await requireSession(request, env);
  if (session instanceof Response) return session;

  const ensured = await ensureThreadForReservation(env, reservationId);
  if (!ensured) {
    return serviceError(request, env, 404, "NOT_FOUND", "Reservation not found");
  }

  const { reservation, thread } = ensured;
  const [messages, notifications] = await Promise.all([
    listGuestMessages(env, thread.id),
    listNotificationsForReservation(env, reservationId),
  ]);

  let guestProfile = null;
  if (reservation.contactId) {
    guestProfile = await getOrCreateProfile(env, reservation.contactId);
  }

  return jsonResponse(request, env, {
    thread: serializeThread(thread),
    reservation: {
      id: reservation.id,
      guestName: reservation.guestName,
      guestEmail: reservation.guestEmail,
      guestPhone: reservation.guestPhone,
      reference: reservation.reference,
      serviceDate: reservation.serviceDate,
      startTime: reservation.startTime,
      contactId: reservation.contactId,
    },
    guestProfile,
    messages: messages.map(serializeMessage),
    notifications: notifications.map(serializeNotification),
    timeline: buildTimeline(notifications, messages),
  });
}

const PostContactSchema = z.object({
  body: z.string().trim().min(1).max(8000),
  subject: z.string().trim().max(200).optional(),
});

/** POST /service/reservations/:id/contact — staff email reply (no leads). */
export async function handlePostReservationContact(
  request: Request,
  env: Env,
  reservationId: string
): Promise<Response> {
  const session = await requireSession(request, env);
  if (session instanceof Response) return session;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return serviceError(request, env, 400, "INVALID_JSON", "Invalid JSON");
  }

  const parsed = PostContactSchema.safeParse(raw);
  if (!parsed.success) {
    return serviceError(
      request,
      env,
      400,
      "VALIDATION",
      "Invalid contact payload",
      parsed.error.flatten()
    );
  }

  const ensured = await ensureThreadForReservation(env, reservationId);
  if (!ensured) {
    return serviceError(request, env, 404, "NOT_FOUND", "Reservation not found");
  }

  const { reservation, thread, locationId } = ensured;
  const email = reservation.guestEmail?.trim();
  if (!email) {
    return serviceError(
      request,
      env,
      400,
      "EMAIL_REQUIRED",
      "This booking has no guest email"
    );
  }

  const venue = await getVenueSettings(env, locationId);
  const brand = (venue.brand ?? {}) as Record<string, unknown>;
  const venueName =
    (typeof brand.displayName === "string" && brand.displayName.trim()) ||
    (typeof brand.venueName === "string" && brand.venueName.trim()) ||
    (typeof brand.name === "string" && brand.name.trim()) ||
    "Restaurant";
  const subject =
    parsed.data.subject?.trim() ||
    `Message from ${venueName} — ${reservation.reference}`;

  const bodyText = parsed.data.body.trim();
  const paragraphs = bodyText
    .split(/\n+/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p style="margin:0 0 12px;">${escapeHtml(p)}</p>`)
    .join("");

  const html = emailLayout(
    {
      venueName,
      accent: null,
      logoUrl: null,
      addressText: null,
      contactPhone: null,
    },
    `
    <p style="margin:0 0 12px;">Hi ${escapeHtml(reservation.guestName)},</p>
    ${paragraphs}
    <p style="margin:16px 0 0;color:#57534e;font-size:13px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
      Regarding booking ${escapeHtml(reservation.reference)}
    </p>
  `
  );

  let sendStatus: "sent" | "failed" | "queued" = "queued";
  let errorText: string | null = null;
  let providerMessageId: string | null = null;
  try {
    const sent = await sendBookingEmail(env, {
      to: email,
      subject,
      html,
      text: `Hi ${reservation.guestName},\n\n${bodyText}\n\n— ${venueName}\nBooking ${reservation.reference}`,
    });
    sendStatus = sent ? "sent" : "queued";
    providerMessageId = sent?.id?.trim() || null;
  } catch (e) {
    sendStatus = "failed";
    errorText = e instanceof Error ? e.message : String(e);
  }

  const notificationId = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO notifications (
       id, organization_id, location_id, reservation_id, channel, template,
       to_address, status, scheduled_for, sent_at, error_text, provider_message_id,
       idempotency_key, payload_json
     ) VALUES (?, ?, ?, ?, 'email', 'staff_reply', ?, ?, datetime('now'), ?, ?, ?, ?, ?)`
  )
    .bind(
      notificationId,
      env.ORGANIZATION_ID,
      locationId,
      reservation.id,
      email,
      sendStatus === "sent" ? "sent" : sendStatus === "failed" ? "failed" : "scheduled",
      sendStatus === "sent" ? new Date().toISOString() : null,
      errorText,
      providerMessageId,
      `staff-reply:${reservation.id}:${notificationId}`,
      JSON.stringify({
        guestName: reservation.guestName,
        subject,
        body: bodyText,
        staffUserId: session.row.id,
      })
    )
    .run();

  const message = await appendGuestMessage(env, {
    threadId: thread.id,
    direction: "outbound",
    channel: "email",
    body: bodyText,
    subject,
    notificationId,
    staffUserId: session.row.id,
    status: sendStatus,
  });

  await insertDomainEvent(env.DB, env.ORGANIZATION_ID, {
    type: "reservation.updated",
    payload: {
      reservationId: reservation.id,
      serviceDate: reservation.serviceDate,
      patch: {
        guestContact: true,
        messageId: message.id,
        status: sendStatus,
      },
    },
  });

  if (sendStatus === "failed") {
    return serviceError(
      request,
      env,
      502,
      "EMAIL_FAILED",
      errorText ?? "Failed to send email",
      { message: serializeMessage(message) }
    );
  }

  const [messages, notifications] = await Promise.all([
    listGuestMessages(env, thread.id),
    listNotificationsForReservation(env, reservationId),
  ]);

  return jsonResponse(request, env, {
    thread: serializeThread((await getGuestThreadByReservation(env, reservationId))!),
    message: serializeMessage(message),
    timeline: buildTimeline(notifications, messages),
  });
}

/** GET /service/guest-threads — Inbox Guests list. */
export async function handleListGuestThreads(
  request: Request,
  env: Env
): Promise<Response> {
  const session = await requireSession(request, env);
  if (session instanceof Response) return session;

  const url = new URL(request.url);
  const limitRaw = Number(url.searchParams.get("limit") ?? "50");
  const limit = Number.isFinite(limitRaw)
    ? Math.min(Math.max(Math.floor(limitRaw), 1), 100)
    : 50;
  const includeMuted = url.searchParams.get("includeMuted") === "1";

  const threads = await listGuestThreads(env, { limit, includeMuted });
  return jsonResponse(request, env, {
    threads: threads.map(serializeThread),
  });
}

/** GET /service/guest-threads/:id — thread detail for Inbox. */
export async function handleGetGuestThread(
  request: Request,
  env: Env,
  threadId: string
): Promise<Response> {
  const session = await requireSession(request, env);
  if (session instanceof Response) return session;

  const thread = await env.DB.prepare(
    `SELECT * FROM guest_threads WHERE id = ? AND organization_id = ?`
  )
    .bind(threadId, env.ORGANIZATION_ID)
    .first<GuestThreadRow>();

  if (!thread) {
    return serviceError(request, env, 404, "NOT_FOUND", "Thread not found");
  }

  const messages = await listGuestMessages(env, thread.id);
  const notifications = thread.reservation_id
    ? await listNotificationsForReservation(env, thread.reservation_id)
    : [];

  let reservation = null;
  if (thread.reservation_id) {
    reservation = await getReservation(env, thread.reservation_id);
  }

  return jsonResponse(request, env, {
    thread: serializeThread(thread),
    reservation: reservation
      ? {
          id: reservation.id,
          guestName: reservation.guestName,
          guestEmail: reservation.guestEmail,
          guestPhone: reservation.guestPhone,
          reference: reservation.reference,
          serviceDate: reservation.serviceDate,
          startTime: reservation.startTime,
        }
      : null,
    messages: messages.map(serializeMessage),
    notifications: notifications.map(serializeNotification),
    timeline: buildTimeline(notifications, messages),
  });
}

const FlagThreadSchema = z.object({
  reason: z.string().trim().max(500).optional(),
});

/** POST /service/guest-threads/:id/flag */
export async function handleFlagGuestThread(
  request: Request,
  env: Env,
  threadId: string
): Promise<Response> {
  const session = await requireSession(request, env);
  if (session instanceof Response) return session;

  let raw: unknown = {};
  try {
    raw = await request.json();
  } catch {
    raw = {};
  }

  const parsed = FlagThreadSchema.safeParse(raw);
  if (!parsed.success) {
    return serviceError(
      request,
      env,
      400,
      "VALIDATION",
      "Invalid flag payload",
      parsed.error.flatten()
    );
  }

  const thread = await flagThread(env, threadId, parsed.data.reason);
  if (!thread) {
    return serviceError(request, env, 404, "NOT_FOUND", "Thread not found");
  }

  return jsonResponse(request, env, { thread: serializeThread(thread) });
}

/** POST /service/guest-threads/:id/mute */
export async function handleMuteGuestThread(
  request: Request,
  env: Env,
  threadId: string
): Promise<Response> {
  const session = await requireSession(request, env);
  if (session instanceof Response) return session;

  const thread = await muteThread(env, threadId);
  if (!thread) {
    return serviceError(request, env, 404, "NOT_FOUND", "Thread not found");
  }

  return jsonResponse(request, env, { thread: serializeThread(thread) });
}

/** POST /service/guest-threads/:id/unmute */
export async function handleUnmuteGuestThread(
  request: Request,
  env: Env,
  threadId: string
): Promise<Response> {
  const session = await requireSession(request, env);
  if (session instanceof Response) return session;

  const thread = await unmuteThread(env, threadId);
  if (!thread) {
    return serviceError(request, env, 404, "NOT_FOUND", "Thread not found");
  }

  return jsonResponse(request, env, { thread: serializeThread(thread) });
}
