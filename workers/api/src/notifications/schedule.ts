import type { Env } from "../env";
import { deferIfQuietHours } from "../lib/venue-time";
import {
  appendGuestMessage,
  notificationLabel,
  upsertGuestThread,
} from "../plugins/service/db/guest-threads";
import { emitGuestContactUpdated } from "../plugins/service/db/guest-contact-events";

export type NotificationChannel = "email" | "sms";
export type NotificationTemplate =
  | "reservation_confirmed"
  | "reservation_reminder"
  | "reservation_reminder_sms"
  | "reservation_changed"
  | "reservation_cancelled"
  | "review_request";

export type ScheduleNotificationParams = {
  locationId: string;
  reservationId: string;
  channel: NotificationChannel;
  template: NotificationTemplate;
  toAddress: string;
  scheduledFor: Date;
  payload: Record<string, unknown>;
};

export function notificationIdempotencyKey(
  reservationId: string,
  template: string,
  channel: string,
  scheduledForIso: string
): string {
  return `${reservationId}:${template}:${channel}:${scheduledForIso}`;
}

/**
 * Insert a scheduled notification. Duplicate idempotency key → skip (ok).
 */
export async function scheduleNotification(
  env: Env,
  params: ScheduleNotificationParams
): Promise<{ id: string; inserted: boolean }> {
  const id = crypto.randomUUID();
  const scheduledFor = params.scheduledFor.toISOString();
  const key = notificationIdempotencyKey(
    params.reservationId,
    params.template,
    params.channel,
    scheduledFor
  );

  try {
    const result = await env.DB.prepare(
      `INSERT INTO notifications (
         id, organization_id, location_id, reservation_id, channel, template,
         to_address, status, scheduled_for, idempotency_key, payload_json
       ) VALUES (?, ?, ?, ?, ?, ?, ?, 'scheduled', ?, ?, ?)`
    )
      .bind(
        id,
        env.ORGANIZATION_ID,
        params.locationId,
        params.reservationId,
        params.channel,
        params.template,
        params.toAddress,
        scheduledFor,
        key,
        JSON.stringify(params.payload)
      )
      .run();

    return { id, inserted: result.meta.changes === 1 };
  } catch (e) {
    const msg = String(e);
    if (msg.includes("UNIQUE") || msg.includes("unique")) {
      return { id, inserted: false };
    }
    throw e;
  }
}

/** Cancel outstanding scheduled (and recoverable sending) rows for a booking. */
export async function cancelScheduledNotifications(
  env: Env,
  reservationId: string
): Promise<number> {
  const result = await env.DB.prepare(
    `UPDATE notifications
     SET status = 'cancelled', updated_at = datetime('now')
     WHERE organization_id = ? AND reservation_id = ?
       AND status IN ('scheduled', 'sending')`
  )
    .bind(env.ORGANIZATION_ID, reservationId)
    .run();
  return result.meta.changes;
}

export type BookingNotifyContext = {
  locationId: string;
  reservationId: string;
  guestName: string;
  guestEmail: string | null;
  guestPhone: string | null;
  reference: string;
  serviceDate: string;
  startTime: string;
  partySize: number;
  startsAtUtc: string;
  manageUrl: string;
  venueName: string;
  timezone: string;
  addressText: string | null;
  contactPhone: string | null;
  brand: Record<string, unknown> | null;
  quietHoursStart?: string;
  quietHoursEnd?: string;
};

/**
 * Schedule confirmation (due now) + reminders at reserve/modify time.
 * Reminder email + SMS both respect quiet hours.
 */
export async function scheduleBookingNotifications(
  env: Env,
  ctx: BookingNotifyContext,
  opts: { includeConfirmations: boolean; kind: "created" | "changed" }
): Promise<void> {
  const now = new Date();
  const startsAt = new Date(ctx.startsAtUtc);
  const payload = {
    guestName: ctx.guestName,
    reference: ctx.reference,
    serviceDate: ctx.serviceDate,
    startTime: ctx.startTime,
    partySize: ctx.partySize,
    manageUrl: ctx.manageUrl,
    venueName: ctx.venueName,
    addressText: ctx.addressText,
    contactPhone: ctx.contactPhone,
    brand: ctx.brand,
  };

  const thread = await upsertGuestThread(env, {
    locationId: ctx.locationId,
    reservationId: ctx.reservationId,
    guestName: ctx.guestName,
    guestEmail: ctx.guestEmail,
    guestPhone: ctx.guestPhone,
  });

  let linkedAny = false;

  async function scheduleAndLink(
    params: Omit<ScheduleNotificationParams, "locationId" | "reservationId">
  ): Promise<void> {
    const result = await scheduleNotification(env, {
      locationId: ctx.locationId,
      reservationId: ctx.reservationId,
      ...params,
    });
    if (!result.inserted) return;
    linkedAny = true;
    const label = notificationLabel(params.template, params.channel);
    await appendGuestMessage(env, {
      threadId: thread.id,
      direction: "system",
      channel: params.channel,
      body: label,
      notificationId: result.id,
      status: "scheduled",
    });
  }

  if (opts.includeConfirmations) {
    const template =
      opts.kind === "changed" ? "reservation_changed" : "reservation_confirmed";

    if (ctx.guestEmail) {
      await scheduleAndLink({
        channel: "email",
        template,
        toAddress: ctx.guestEmail,
        scheduledFor: now,
        payload,
      });
    }
    if (bookingSmsEnabled(env) && ctx.guestPhone) {
      await scheduleAndLink({
        channel: "sms",
        template,
        toAddress: ctx.guestPhone,
        scheduledFor: now,
        payload,
      });
    }
  }

  const quietHours = { start: ctx.quietHoursStart, end: ctx.quietHoursEnd };

  let emailReminderAt = new Date(startsAt.getTime() - 24 * 60 * 60 * 1000);
  if (ctx.guestEmail && emailReminderAt.getTime() > now.getTime()) {
    emailReminderAt = deferIfQuietHours(emailReminderAt, ctx.timezone, quietHours);
    if (emailReminderAt.getTime() > now.getTime()) {
      await scheduleAndLink({
        channel: "email",
        template: "reservation_reminder",
        toAddress: ctx.guestEmail,
        scheduledFor: emailReminderAt,
        payload,
      });
    }
  }

  let smsReminderAt = new Date(startsAt.getTime() - 3 * 60 * 60 * 1000);
  if (
    bookingSmsEnabled(env) &&
    ctx.guestPhone &&
    smsReminderAt.getTime() > now.getTime()
  ) {
    smsReminderAt = deferIfQuietHours(smsReminderAt, ctx.timezone, quietHours);
    if (smsReminderAt.getTime() > now.getTime()) {
      await scheduleAndLink({
        channel: "sms",
        template: "reservation_reminder_sms",
        toAddress: ctx.guestPhone,
        scheduledFor: smsReminderAt,
        payload,
      });
    }
  }

  if (linkedAny) {
    await emitGuestContactUpdated(env, {
      reservationId: ctx.reservationId,
      serviceDate: ctx.serviceDate,
      reason: "scheduled",
    });
  }
}

function bookingSmsEnabled(env: Env): boolean {
  return env.ENABLE_BOOKING_SMS === "true";
}
