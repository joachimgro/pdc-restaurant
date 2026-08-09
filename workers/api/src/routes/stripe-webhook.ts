import { jsonResponse } from "../cors";
import { domainEventStatement } from "../db/events";
import type { Env } from "../env";
import { depositsEnabled } from "../capabilities";
import { dispatchDueNotifications } from "../notifications/dispatch";
import { scheduleBookingNotifications } from "../notifications/schedule";
import {
  getPaymentByCheckoutSession,
  markPaymentSucceeded,
  recordPaymentEvent,
} from "../plugins/service/db/payments";
import {
  getReservation,
  reservationEventStatement,
} from "../plugins/service/db/reservations";
import { getVenueSettings } from "../plugins/service/db/venue";
import { mintGuestToken } from "../plugins/service/guest-tokens";
import { guestBookingOrigin } from "../lib/venue-time";
import {
  parseStripeEvent,
  verifyStripeWebhook,
} from "../payments/stripe";

export async function handleStripeWebhook(
  request: Request,
  env: Env
): Promise<Response> {
  if (!depositsEnabled(env)) {
    return jsonResponse(request, env, { error: "Deposits disabled" }, 404);
  }

  if (!env.STRIPE_WEBHOOK_SECRET) {
    return new Response("Webhook verification not configured", { status: 500 });
  }

  const payload = await request.text();
  const signature = request.headers.get("stripe-signature");
  const valid = await verifyStripeWebhook(
    payload,
    signature,
    env.STRIPE_WEBHOOK_SECRET
  );
  if (!valid) {
    return new Response("Invalid signature", { status: 403 });
  }

  const event = parseStripeEvent(payload);
  if (event.type !== "checkout.session.completed") {
    return jsonResponse(request, env, { ok: true, skipped: true });
  }

  const session = event.data.object;
  const payment = await getPaymentByCheckoutSession(env, session.id);
  if (!payment || !payment.reservation_id) {
    return jsonResponse(request, env, { ok: true, skipped: true });
  }

  const inserted = await recordPaymentEvent(env, {
    paymentId: payment.id,
    stripeEventId: event.id,
    type: event.type,
    payload: event,
  });
  if (!inserted) {
    return jsonResponse(request, env, { ok: true, replay: true });
  }

  const reservation = await getReservation(env, payment.reservation_id);
  if (!reservation) {
    return jsonResponse(request, env, { ok: true, skipped: true });
  }

  if (reservation.status === "confirmed") {
    return jsonResponse(request, env, { ok: true, already: true });
  }

  await markPaymentSucceeded(
    env,
    payment.id,
    session.payment_intent ?? null
  );

  await env.DB.batch([
    env.DB.prepare(
      `UPDATE reservations
       SET status = 'confirmed', updated_at = datetime('now')
       WHERE id = ? AND organization_id = ? AND status = 'pending_payment'`
    ).bind(reservation.id, env.ORGANIZATION_ID),
    reservationEventStatement(
      env,
      reservation.id,
      "payment.succeeded",
      "stripe:webhook",
      { paymentId: payment.id }
    ),
    domainEventStatement(env.DB, env.ORGANIZATION_ID, {
      type: "reservation.status_changed",
      payload: {
        reservationId: reservation.id,
        serviceDate: reservation.serviceDate,
        from: "pending_payment",
        to: "confirmed",
      },
    }).statement,
  ]);

  const settings = await getVenueSettings(env, payment.location_id);
  const { rawToken } = await mintGuestToken(env, {
    reservationId: reservation.id,
  });
  const origin = guestBookingOrigin(env);
  const manageUrl = `${origin}/book/manage/${rawToken}`;

  await scheduleBookingNotifications(
    env,
    {
      locationId: payment.location_id,
      reservationId: reservation.id,
      guestName: reservation.guestName,
      guestEmail: reservation.guestEmail,
      guestPhone: reservation.guestPhone,
      reference: reservation.reference,
      serviceDate: reservation.serviceDate,
      startTime: reservation.startTime,
      partySize: reservation.partySize,
      startsAtUtc: reservation.startsAtUtc,
      manageUrl,
      venueName:
        (settings.brand?.venueName as string | undefined) ?? "Restaurant",
      timezone: settings.timezone,
      addressText: settings.addressText,
      contactPhone: settings.contactPhone,
      brand: settings.brand,
    },
    { includeConfirmations: true, kind: "created" }
  );

  await dispatchDueNotifications(env, { limit: 10 });

  return jsonResponse(request, env, { ok: true });
}
