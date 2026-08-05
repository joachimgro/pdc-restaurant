import type { Env } from "../env";
import { sendEmail } from "../email/send";
import {
  reservationCancelledEmail,
  reservationChangedEmail,
  reservationConfirmedEmail,
  reservationReminderEmail,
  type ReservationEmailPayload,
} from "../email/templates/reservation-emails";
import {
  confirmationSmsBody,
  reminderSmsBody,
  sendBookingSms,
} from "./sms";

const STALE_SENDING_MINUTES = 10;
const MAX_ATTEMPTS = 5;

type NotificationRow = {
  id: string;
  reservation_id: string | null;
  channel: string;
  template: string;
  to_address: string;
  status: string;
  scheduled_for: string | null;
  attempts: number;
  payload_json: string | null;
};

const ACTIVE_FOR_SEND = new Set(["confirmed", "seated", "pending_payment"]);

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
    `SELECT id, reservation_id, channel, template, to_address, status,
            scheduled_for, attempts, payload_json
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

  for (const row of results ?? []) {
    const took = await claimNotification(env, row.id, nowIso);
    if (!took) continue;
    claimed += 1;

    try {
      if (row.reservation_id) {
        const status = await reservationStatus(env, row.reservation_id);
        if (!status || !ACTIVE_FOR_SEND.has(status)) {
          await markNotification(env, row.id, "skipped", {
            errorText: `reservation_status:${status ?? "missing"}`,
          });
          skipped += 1;
          continue;
        }
      }

      const providerId = await deliver(env, row);
      await markNotification(env, row.id, "sent", {
        providerMessageId: providerId,
        sentAt: true,
      });
      sent += 1;
    } catch (e) {
      const msg = String(e).slice(0, 500);
      const attempts = row.attempts + 1;
      if (attempts >= MAX_ATTEMPTS) {
        await markNotification(env, row.id, "failed", { errorText: msg });
      } else {
        // Re-queue for a later tick.
        await env.DB.prepare(
          `UPDATE notifications
           SET status = 'scheduled', error_text = ?, updated_at = datetime('now')
           WHERE id = ? AND organization_id = ?`
        )
          .bind(msg, row.id, env.ORGANIZATION_ID)
          .run();
      }
      failed += 1;
      console.error("notification send failed", { id: row.id, error: msg });
    }
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
  await env.DB.prepare(
    `UPDATE notifications
     SET status = 'scheduled', updated_at = datetime('now')
     WHERE organization_id = ?
       AND status = 'sending'
       AND updated_at < datetime('now', ?)`
  )
    .bind(env.ORGANIZATION_ID, `-${STALE_SENDING_MINUTES} minutes`)
    .run();
}

async function reservationStatus(
  env: Env,
  reservationId: string
): Promise<string | null> {
  const row = await env.DB.prepare(
    `SELECT status FROM reservations WHERE id = ? AND organization_id = ?`
  )
    .bind(reservationId, env.ORGANIZATION_ID)
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
    const result = await sendEmail(env, {
      to: row.to_address,
      subject: built.subject,
      html: built.html,
      text: built.text,
      replyTo: payload.contactPhone ? undefined : (payload.contactEmail as string | undefined),
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

function buildEmail(template: string, p: ReservationEmailPayload) {
  switch (template) {
    case "reservation_confirmed":
      return reservationConfirmedEmail(p);
    case "reservation_reminder":
      return reservationReminderEmail(p);
    case "reservation_changed":
      return reservationChangedEmail(p);
    case "reservation_cancelled":
      return reservationCancelledEmail(p);
    default:
      return reservationConfirmedEmail(p);
  }
}

function buildSms(template: string, p: ReservationEmailPayload): string {
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
