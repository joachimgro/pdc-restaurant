import type { Env } from "../env";
import { sendBookingEmail } from "../email/send";
import {
  reservationCancelledEmail,
  reservationChangedEmail,
  reservationConfirmedEmail,
  reservationReminderEmail,
  reviewRequestEmail,
  type ReservationEmailPayload,
  type ReviewRequestEmailPayload,
} from "../email/templates/reservation-emails";
import {
  emitGuestContactUpdated,
  serviceDateForReservation,
} from "../plugins/service/db/guest-contact-events";
import {
  confirmationSmsBody,
  reminderSmsBody,
  sendBookingSms,
} from "./sms";
import {
  MAX_ATTEMPTS,
  nextRetryScheduledFor,
  reminderSkipReason,
  reminderStaleMinutesFromEnv,
} from "./policy";

const STALE_SENDING_MINUTES = 10;

type NotificationRow = {
  id: string;
  reservation_id: string | null;
  waitlist_entry_id: string | null;
  channel: string;
  template: string;
  to_address: string;
  status: string;
  scheduled_for: string | null;
  attempts: number;
  payload_json: string | null;
  provider_message_id: string | null;
};

const ACTIVE_FOR_SEND = new Set(["confirmed", "seated", "pending_payment"]);
const WAITLIST_TEMPLATES = new Set(["waitlist_joined", "waitlist_table_ready"]);

/**
 * Dispatch due notifications with claim + send-time reservation checks.
 * See GUEST-LOOP-BUILD-PLAN §3a.
 */
export async function dispatchDueNotifications(
  env: Env,
  opts: { limit?: number; now?: Date } = {}
): Promise<{ claimed: number; sent: number; skipped: number; failed: number }> {
  const limit = opts.limit ?? 50;
  const now = opts.now ?? new Date();
  const nowIso = now.toISOString();

  await recoverStaleSending(env);

  const { results } = await env.DB.prepare(
    `SELECT id, reservation_id, waitlist_entry_id, channel, template, to_address, status,
            scheduled_for, attempts, payload_json, provider_message_id
     FROM notifications
     WHERE organization_id = ?
       AND status = 'scheduled'
       AND scheduled_for IS NOT NULL
       AND scheduled_for <= ?
     ORDER BY scheduled_for ASC
     LIMIT ?`
  )
    .bind(env.ORGANIZATION_ID, nowIso, limit)
    .all<NotificationRow>();

  let claimed = 0;
  let sent = 0;
  let skipped = 0;
  let failed = 0;
  const touchedReservations = new Set<string>();

  for (const row of results ?? []) {
    const took = await claimNotification(env, row.id, nowIso);
    if (!took) continue;
    claimed += 1;

    // Defensive: a row that already carries a provider id was already sent
    // by a previous claim (e.g. recovered from a crash mid-send). Never call
    // deliver() again for it — just settle the bookkeeping.
    if (row.provider_message_id) {
      await markNotification(env, row.id, "sent", {
        providerMessageId: row.provider_message_id,
        sentAt: true,
      });
      sent += 1;
      if (row.reservation_id) touchedReservations.add(row.reservation_id);
      continue;
    }

    try {
      if (row.waitlist_entry_id && WAITLIST_TEMPLATES.has(row.template)) {
        const status = await waitlistEntryStatus(env, row.waitlist_entry_id);
        const allowed =
          row.template === "waitlist_table_ready"
            ? status === "notified"
            : status === "waiting";
        if (!allowed) {
          await markNotification(env, row.id, "skipped", {
            errorText: `waitlist_status:${status ?? "missing"}`,
          });
          skipped += 1;
          continue;
        }
      } else if (row.reservation_id) {
        const res = await reservationSendState(env, row.reservation_id);
        const status = res?.status ?? null;
        const reviewRequest = row.template === "review_request";
        const allowed = reviewRequest
          ? status === "finished"
          : status && ACTIVE_FOR_SEND.has(status);
        if (!allowed) {
          await markNotification(env, row.id, "skipped", {
            errorText: `reservation_status:${status ?? "missing"}`,
          });
          skipped += 1;
          touchedReservations.add(row.reservation_id);
          continue;
        }

        const skip = reminderSkipReason(
          row.template,
          now,
          row.scheduled_for,
          res?.startsAtUtc ?? null,
          reminderStaleMinutesFromEnv(env)
        );
        if (skip) {
          await markNotification(env, row.id, "skipped", { errorText: skip });
          console.log("notification skipped", {
            id: row.id,
            template: row.template,
            reason: skip,
          });
          skipped += 1;
          touchedReservations.add(row.reservation_id);
          continue;
        }
      }

      const providerId = await deliver(env, row);
      if (!providerId && row.channel === "sms") {
        const { isSmsSuppressed } = await import("./sms-suppression");
        if (await isSmsSuppressed(env, row.to_address)) {
          await markNotification(env, row.id, "skipped", {
            errorText: "sms_suppressed",
          });
          skipped += 1;
          if (row.reservation_id) touchedReservations.add(row.reservation_id);
          continue;
        }
        throw new Error("SMS send returned no provider id");
      }
      await markNotification(env, row.id, "sent", {
        providerMessageId: providerId,
        sentAt: true,
      });
      sent += 1;
      if (row.reservation_id) touchedReservations.add(row.reservation_id);
    } catch (e) {
      const msg = String(e).slice(0, 500);
      const attempts = row.attempts + 1;
      if (attempts >= MAX_ATTEMPTS) {
        await markNotification(env, row.id, "failed", { errorText: msg });
      } else {
        const retryAt = nextRetryScheduledFor(attempts, now);
        await env.DB.prepare(
          `UPDATE notifications
           SET status = 'scheduled',
               scheduled_for = ?,
               error_text = ?,
               updated_at = datetime('now')
           WHERE id = ? AND organization_id = ?`
        )
          .bind(
            (retryAt ?? now).toISOString(),
            msg,
            row.id,
            env.ORGANIZATION_ID
          )
          .run();
      }
      failed += 1;
      if (row.reservation_id) touchedReservations.add(row.reservation_id);
      console.error("notification send failed", { id: row.id, error: msg });
    }
  }

  for (const reservationId of touchedReservations) {
    const serviceDate = await serviceDateForReservation(env, reservationId);
    if (!serviceDate) continue;
    await emitGuestContactUpdated(env, {
      reservationId,
      serviceDate,
      reason: "dispatch",
    });
  }

  return { claimed, sent, skipped, failed };
}

async function claimNotification(
  env: Env,
  id: string,
  nowIso: string
): Promise<boolean> {
  const result = await env.DB.prepare(
    `UPDATE notifications
     SET status = 'sending', attempts = attempts + 1, updated_at = datetime('now')
     WHERE id = ? AND organization_id = ?
       AND status = 'scheduled'
       AND scheduled_for <= ?`
  )
    .bind(id, env.ORGANIZATION_ID, nowIso)
    .run();
  return result.meta.changes === 1;
}

async function recoverStaleSending(env: Env): Promise<void> {
  // A row stuck in 'sending' that already has a provider id got its email
  // out before the worker died — resetting it to 'scheduled' would send it
  // again on the next tick. Settle it as sent instead.
  await env.DB.prepare(
    `UPDATE notifications
     SET status = 'sent', sent_at = COALESCE(sent_at, datetime('now')),
         updated_at = datetime('now')
     WHERE organization_id = ?
       AND status = 'sending'
       AND updated_at < datetime('now', ?)
       AND provider_message_id IS NOT NULL`
  )
    .bind(env.ORGANIZATION_ID, `-${STALE_SENDING_MINUTES} minutes`)
    .run();

  // Only rows with no provider id — i.e. the send never definitively
  // happened — are safe to requeue.
  await env.DB.prepare(
    `UPDATE notifications
     SET status = 'scheduled', updated_at = datetime('now')
     WHERE organization_id = ?
       AND status = 'sending'
       AND updated_at < datetime('now', ?)
       AND provider_message_id IS NULL`
  )
    .bind(env.ORGANIZATION_ID, `-${STALE_SENDING_MINUTES} minutes`)
    .run();
}

async function reservationSendState(
  env: Env,
  reservationId: string
): Promise<{ status: string; startsAtUtc: string | null } | null> {
  const row = await env.DB.prepare(
    `SELECT status, starts_at_utc FROM reservations
     WHERE id = ? AND organization_id = ?`
  )
    .bind(reservationId, env.ORGANIZATION_ID)
    .first<{ status: string; starts_at_utc: string | null }>();
  if (!row) return null;
  return { status: row.status, startsAtUtc: row.starts_at_utc };
}

async function waitlistEntryStatus(
  env: Env,
  waitlistEntryId: string
): Promise<string | null> {
  const row = await env.DB.prepare(
    `SELECT status FROM waitlist_entries WHERE id = ? AND organization_id = ?`
  )
    .bind(waitlistEntryId, env.ORGANIZATION_ID)
    .first<{ status: string }>();
  return row?.status ?? null;
}

async function markNotification(
  env: Env,
  id: string,
  status: string,
  opts: {
    errorText?: string;
    providerMessageId?: string | null;
    sentAt?: boolean;
  } = {}
): Promise<void> {
  await env.DB.prepare(
    `UPDATE notifications
     SET status = ?,
         error_text = COALESCE(?, error_text),
         provider_message_id = COALESCE(?, provider_message_id),
         sent_at = CASE WHEN ? = 1 THEN datetime('now') ELSE sent_at END,
         updated_at = datetime('now')
     WHERE id = ? AND organization_id = ?`
  )
    .bind(
      status,
      opts.errorText ?? null,
      opts.providerMessageId ?? null,
      opts.sentAt ? 1 : 0,
      id,
      env.ORGANIZATION_ID
    )
    .run();
}

async function deliver(env: Env, row: NotificationRow): Promise<string | null> {
  const payload = parsePayload(row.payload_json);
  if (row.channel === "email") {
    const built = buildEmail(row.template, payload);
    const result = await sendBookingEmail(env, {
      to: row.to_address,
      subject: built.subject,
      html: built.html,
      text: built.text,
      idempotencyKey: `notification:${row.id}`,
    });
    return result?.id ?? null;
  }

  if (row.channel === "sms") {
    const body = buildSms(row.template, payload);
    const result = await sendBookingSms(env, row.to_address, body);
    return result?.id ?? null;
  }

  throw new Error(`Unknown channel ${row.channel}`);
}

function parsePayload(json: string | null): ReservationEmailPayload & Record<string, unknown> {
  if (!json) {
    return {
      guestName: "Guest",
      reference: "",
      serviceDate: "",
      startTime: "",
      partySize: 2,
      manageUrl: "",
      venueName: "Restaurant",
    };
  }
  try {
    return JSON.parse(json) as ReservationEmailPayload & Record<string, unknown>;
  } catch {
    return {
      guestName: "Guest",
      reference: "",
      serviceDate: "",
      startTime: "",
      partySize: 2,
      manageUrl: "",
      venueName: "Restaurant",
    };
  }
}

function buildEmail(
  template: string,
  p: ReservationEmailPayload & Record<string, unknown>
) {
  switch (template) {
    case "reservation_confirmed":
      return reservationConfirmedEmail(p);
    case "reservation_reminder":
      return reservationReminderEmail(p);
    case "reservation_changed":
      return reservationChangedEmail(p);
    case "reservation_cancelled":
      return reservationCancelledEmail(p);
    case "review_request":
      return reviewRequestEmail(p as ReviewRequestEmailPayload);
    case "waitlist_joined":
      return waitlistJoinedEmail(p);
    case "waitlist_table_ready":
      return waitlistTableReadyEmail(p);
    default:
      return reservationConfirmedEmail(p);
  }
}

function waitlistJoinedEmail(p: ReservationEmailPayload & Record<string, unknown>): {
  subject: string;
  html: string;
  text: string;
} {
  const venue = p.venueName || "Restaurant";
  const quote =
    typeof p.quotedWaitMin === "number" ? ` About ${p.quotedWaitMin} minutes.` : "";
  const subject = `You're on the waitlist at ${venue}`;
  const text = [
    `Hi ${p.guestName},`,
    `You're on the waitlist for ${venue} on ${p.serviceDate} (party of ${p.partySize}).`,
    `This is not a confirmed booking.${quote}`,
    `We'll be in touch if a table opens up.`,
  ].join("\n\n");
  const html = `<p>Hi ${escapeBasic(String(p.guestName))},</p><p>You're on the waitlist for <strong>${escapeBasic(venue)}</strong> on <strong>${escapeBasic(String(p.serviceDate))}</strong> (party of ${escapeBasic(String(p.partySize))}).</p><p>This is <strong>not</strong> a confirmed booking.${escapeBasic(quote)}</p><p>We'll be in touch if a table opens up.</p>`;
  return { subject, html, text };
}

function waitlistTableReadyEmail(p: ReservationEmailPayload & Record<string, unknown>): {
  subject: string;
  html: string;
  text: string;
} {
  const venue = p.venueName || "Restaurant";
  const subject = `Your table is ready — ${venue}`;
  const text = [
    `Hi ${p.guestName},`,
    `A table is ready for you at ${venue} (party of ${p.partySize}).`,
    `Please check in with the team soon — this hold won't last forever.`,
  ].join("\n\n");
  const html = `<p>Hi ${escapeBasic(String(p.guestName))},</p><p>A table is ready for you at <strong>${escapeBasic(venue)}</strong> (party of ${escapeBasic(String(p.partySize))}).</p><p>Please check in with the team soon — this hold won't last forever.</p>`;
  return { subject, html, text };
}

function escapeBasic(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildSms(template: string, p: ReservationEmailPayload & Record<string, unknown>): string {
  if (template === "waitlist_joined") {
    const quote =
      typeof p.quotedWaitMin === "number" ? ` ~${p.quotedWaitMin} min.` : "";
    return `${p.venueName}: you're on the waitlist for ${p.serviceDate} (party of ${p.partySize}). Not a booking.${quote}`;
  }
  if (template === "waitlist_table_ready") {
    return `${p.venueName}: your table is ready (party of ${p.partySize}). Please check in soon.`;
  }
  if (
    template === "reservation_reminder_sms" ||
    template === "reservation_reminder"
  ) {
    return reminderSmsBody({
      venueName: p.venueName,
      startTime: p.startTime,
      reference: p.reference,
      manageUrl: p.manageUrl,
    });
  }
  return confirmationSmsBody({
    venueName: p.venueName,
    serviceDate: p.serviceDate,
    startTime: p.startTime,
    partySize: p.partySize,
    reference: p.reference,
    manageUrl: p.manageUrl,
  });
}
