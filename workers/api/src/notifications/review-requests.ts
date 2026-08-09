import type { Env } from "../env";
import { deferToGuestSendWindow } from "../lib/venue-time";
import {
  appendGuestMessage,
  notificationLabel,
  upsertGuestThread,
} from "../plugins/service/db/guest-threads";
import { getVenueSettings } from "../plugins/service/db/venue";
import { emitGuestContactUpdated } from "../plugins/service/db/guest-contact-events";
import { REVIEW_DAY_WINDOW } from "./policy";

type ReviewCandidate = {
  id: string;
  location_id: string;
  guest_email: string;
  guest_name: string;
  guest_phone: string | null;
  reference: string;
  service_date: string;
  start_time: string;
  party_size: number;
  finished_at: string;
  review_url: string;
  review_request_delay_hours: number;
  timezone: string;
  brand_json: string | null;
  address_text: string | null;
  contact_phone: string | null;
};

function reviewIdempotencyKey(reservationId: string): string {
  return `review:${reservationId}`;
}

/**
 * Cron step: schedule one post-visit review email per finished booking.
 * Skips venues without review_url. Idempotent via review:{reservationId}.
 */
export async function scheduleDueReviewRequests(
  env: Env
): Promise<{ scheduled: number }> {
  const { results } = await env.DB.prepare(
    `SELECT r.id, r.location_id, r.guest_email, r.guest_name, r.guest_phone,
            r.reference, r.service_date, r.start_time, r.party_size, r.finished_at,
            vs.review_url, vs.review_request_delay_hours, vs.timezone,
            vs.brand_json, vs.address_text, vs.contact_phone
     FROM reservations r
     JOIN venue_settings vs ON vs.location_id = r.location_id
       AND vs.organization_id = r.organization_id
     WHERE r.organization_id = ?
       AND r.status = 'finished'
       AND r.guest_email IS NOT NULL
       AND vs.review_url IS NOT NULL AND trim(vs.review_url) != ''
       AND r.finished_at IS NOT NULL
       AND datetime(r.finished_at, '+' || vs.review_request_delay_hours || ' hours') <= datetime('now')
       AND NOT EXISTS (
         SELECT 1 FROM notifications n
         WHERE n.organization_id = r.organization_id
           AND n.idempotency_key = 'review:' || r.id
       )
     ORDER BY r.finished_at ASC
     LIMIT 50`
  )
    .bind(env.ORGANIZATION_ID)
    .all<ReviewCandidate>();

  let scheduled = 0;

  for (const row of results ?? []) {
    let brand: Record<string, unknown> | null = null;
    if (row.brand_json) {
      try {
        const parsed: unknown = JSON.parse(row.brand_json);
        brand =
          parsed && typeof parsed === "object" && !Array.isArray(parsed)
            ? (parsed as Record<string, unknown>)
            : null;
      } catch {
        brand = null;
      }
    }

    const settings = await getVenueSettings(env, row.location_id);
    const venueName =
      (brand?.venueName as string | undefined) ??
      (settings.brand?.venueName as string | undefined) ??
      "Restaurant";

    const payload = {
      guestName: row.guest_name,
      reference: row.reference,
      serviceDate: row.service_date,
      startTime: row.start_time,
      partySize: row.party_size,
      venueName,
      reviewUrl: row.review_url,
      addressText: row.address_text,
      contactPhone: row.contact_phone,
      brand,
    };

    const thread = await upsertGuestThread(env, {
      locationId: row.location_id,
      reservationId: row.id,
      guestName: row.guest_name,
      guestEmail: row.guest_email,
      guestPhone: row.guest_phone,
    });

    const notificationId = crypto.randomUUID();
    const rawDue = new Date();
    const scheduledFor = deferToGuestSendWindow(rawDue, row.timezone, {
      quietStart: settings.quietHoursStart,
      quietEnd: settings.quietHoursEnd,
      dayStart: REVIEW_DAY_WINDOW.start,
      dayEnd: REVIEW_DAY_WINDOW.end,
    }).toISOString();

    try {
      const result = await env.DB.prepare(
        `INSERT INTO notifications (
           id, organization_id, location_id, reservation_id, channel, template,
           to_address, status, scheduled_for, idempotency_key, payload_json
         ) VALUES (?, ?, ?, ?, 'email', 'review_request', ?, 'scheduled', ?, ?, ?)`
      )
        .bind(
          notificationId,
          env.ORGANIZATION_ID,
          row.location_id,
          row.id,
          row.guest_email,
          scheduledFor,
          reviewIdempotencyKey(row.id),
          JSON.stringify(payload)
        )
        .run();

      if (result.meta.changes !== 1) continue;

      await appendGuestMessage(env, {
        threadId: thread.id,
        direction: "system",
        channel: "email",
        body: notificationLabel("review_request", "email"),
        notificationId,
        status: "scheduled",
      });

      scheduled += 1;
      await emitGuestContactUpdated(env, {
        reservationId: row.id,
        serviceDate: row.service_date,
        reason: "review_scheduled",
      });
    } catch (e) {
      const msg = String(e);
      if (!msg.includes("UNIQUE") && !msg.includes("unique")) throw e;
    }
  }

  return { scheduled };
}
