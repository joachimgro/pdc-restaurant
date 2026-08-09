import {
  appendGuestMessage,
  upsertGuestThread,
  type GuestThreadRow,
} from "../plugins/service/db/guest-threads";
import { bookingFromAddress } from "../email/send";
import {
  emitGuestContactUpdated,
  serviceDateForReservation,
} from "../plugins/service/db/guest-contact-events";
import { jsonResponse } from "../cors";
import type { Env } from "../env";

type ResendReceivedEvent = {
  type?: string;
  data?: {
    email_id?: string;
    from?: string;
    to?: string[];
    received_for?: string[];
    subject?: string | null;
    message_id?: string | null;
  };
};

type ReceivedEmailBody = {
  id?: string;
  from?: string;
  subject?: string | null;
  text?: string | null;
  html?: string | null;
  headers?: Record<string, string>;
};

function normalizeEmail(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const angle = raw.match(/<([^>]+)>/);
  const addr = (angle?.[1] ?? raw).trim().toLowerCase();
  if (!addr.includes("@")) return null;
  return addr;
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/** Prefer plain text; fall back to stripped HTML. */
function bodyFromReceived(email: ReceivedEmailBody): string {
  const text = email.text?.trim();
  if (text) return text.slice(0, 8000);
  if (email.html?.trim()) return stripHtml(email.html).slice(0, 8000);
  return "(empty message)";
}

function addressedToBookings(env: Env, data: ResendReceivedEvent["data"]): boolean {
  const booking = bookingFromAddress(env).toLowerCase();
  const recipients = [
    ...(data?.to ?? []),
    ...(data?.received_for ?? []),
  ].map((a) => normalizeEmail(a));
  return recipients.some((a) => a === booking);
}

async function fetchReceivedEmail(
  env: Env,
  emailId: string
): Promise<ReceivedEmailBody | null> {
  const apiKey = env.RESEND_API_KEY?.trim();
  if (!apiKey) return null;
  const res = await fetch(
    `https://api.resend.com/emails/receiving/${encodeURIComponent(emailId)}`,
    { headers: { Authorization: `Bearer ${apiKey}` } }
  );
  if (!res.ok) {
    console.error("Resend receiving get failed", res.status, emailId);
    return null;
  }
  return (await res.json()) as ReceivedEmailBody;
}

async function findThreadByGuestEmail(
  env: Env,
  guestEmail: string
): Promise<GuestThreadRow | null> {
  return env.DB.prepare(
    `SELECT * FROM guest_threads
     WHERE organization_id = ? AND guest_email = ?
     ORDER BY COALESCE(last_message_at, created_at) DESC
     LIMIT 1`
  )
    .bind(env.ORGANIZATION_ID, guestEmail)
    .first<GuestThreadRow>();
}

/**
 * Resend inbound: email.received → guest_messages (never creates leads).
 * Configure webhook to POST https://api.kitchen.phiof.digital/webhooks/resend
 * with event email.received. Domain must receive at BOOKING_FROM_EMAIL.
 */
export async function handleResendWebhook(
  request: Request,
  env: Env
): Promise<Response> {
  let event: ResendReceivedEvent;
  try {
    event = (await request.json()) as ResendReceivedEvent;
  } catch {
    return jsonResponse(request, env, { error: "Invalid JSON" }, 400);
  }

  if (event.type !== "email.received") {
    return jsonResponse(request, env, { ok: true, skipped: true, reason: "type" });
  }

  const data = event.data;
  const emailId = data?.email_id?.trim();
  if (!emailId) {
    return jsonResponse(request, env, { ok: true, skipped: true, reason: "no_id" });
  }

  if (!addressedToBookings(env, data)) {
    return jsonResponse(request, env, {
      ok: true,
      skipped: true,
      reason: "not_booking_inbox",
    });
  }

  const fromEmail = normalizeEmail(data?.from);
  if (!fromEmail) {
    return jsonResponse(request, env, { ok: true, skipped: true, reason: "no_from" });
  }

  // Idempotency via notifications.idempotency_key
  const idempotencyKey = `inbound:resend:${emailId}`;
  const existing = await env.DB.prepare(
    `SELECT id FROM notifications WHERE organization_id = ? AND idempotency_key = ?`
  )
    .bind(env.ORGANIZATION_ID, idempotencyKey)
    .first<{ id: string }>();
  if (existing) {
    return jsonResponse(request, env, { ok: true, duplicate: true });
  }

  const full = await fetchReceivedEmail(env, emailId);
  const bodyText = full ? bodyFromReceived(full) : "(could not load body)";
  const subject =
    (full?.subject ?? data?.subject)?.trim() || "(no subject)";

  let thread = await findThreadByGuestEmail(env, fromEmail);

  // Soft create a thread only when we can attach to a reservation by email.
  if (!thread) {
    const reservation = await env.DB.prepare(
      `SELECT id, location_id, guest_name, guest_email, guest_phone, service_date
       FROM reservations
       WHERE organization_id = ? AND lower(guest_email) = ?
       ORDER BY datetime(starts_at_utc) DESC
       LIMIT 1`
    )
      .bind(env.ORGANIZATION_ID, fromEmail)
      .first<{
        id: string;
        location_id: string;
        guest_name: string;
        guest_email: string | null;
        guest_phone: string | null;
        service_date: string;
      }>();

    if (reservation) {
      thread = await upsertGuestThread(env, {
        locationId: reservation.location_id,
        reservationId: reservation.id,
        guestName: reservation.guest_name,
        guestEmail: reservation.guest_email,
        guestPhone: reservation.guest_phone,
      });
    }
  }

  if (!thread) {
    console.warn("Inbound guest email unmatched", { fromEmail, emailId });
    return jsonResponse(request, env, {
      ok: true,
      skipped: true,
      reason: "no_thread",
    });
  }

  const notificationId = crypto.randomUUID();
  try {
    await env.DB.prepare(
      `INSERT INTO notifications (
         id, organization_id, location_id, reservation_id, channel, template,
         to_address, status, scheduled_for, sent_at, provider_message_id,
         idempotency_key, payload_json
       ) VALUES (?, ?, ?, ?, 'email', 'guest_inbound', ?, 'sent', datetime('now'),
                 datetime('now'), ?, ?, ?)`
    )
      .bind(
        notificationId,
        env.ORGANIZATION_ID,
        thread.location_id,
        thread.reservation_id,
        bookingFromAddress(env),
        emailId,
        idempotencyKey,
        JSON.stringify({
          from: fromEmail,
          subject,
          resendEmailId: emailId,
          messageId: data?.message_id ?? null,
        })
      )
      .run();
  } catch (e) {
    const msg = String(e);
    if (msg.includes("UNIQUE") || msg.includes("unique")) {
      return jsonResponse(request, env, { ok: true, duplicate: true });
    }
    throw e;
  }

  await appendGuestMessage(env, {
    threadId: thread.id,
    direction: "inbound",
    channel: "email",
    body: bodyText,
    subject,
    notificationId,
    status: "sent",
  });

  const isMuted = Boolean(thread.muted_at);

  if (thread.reservation_id && !isMuted) {
    const serviceDate =
      (await serviceDateForReservation(env, thread.reservation_id)) ??
      new Date().toISOString().slice(0, 10);
    await emitGuestContactUpdated(env, {
      reservationId: thread.reservation_id,
      serviceDate,
      reason: "inbound",
    });
  }

  return jsonResponse(request, env, {
    ok: true,
    threadId: thread.id,
    reservationId: thread.reservation_id,
    muted: isMuted,
  });
}
