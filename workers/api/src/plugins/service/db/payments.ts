import type { PaymentSummary } from "@lead-intake/shared-types";
import type { Env } from "../../../env";

export type DepositPolicyRow = {
  id: string;
  organization_id: string;
  location_id: string;
  name: string;
  mode: string;
  amount_pence: number;
  no_show_fee_pence: number;
  min_party: number;
  service_period_id: string | null;
  day_of_week: string | null;
  date_from: string | null;
  date_to: string | null;
  cancellation_window_hours: number;
  terms_text: string | null;
  priority: number;
  is_active: number;
};

export type PaymentRow = {
  id: string;
  organization_id: string;
  location_id: string;
  reservation_id: string | null;
  contact_id: string | null;
  purpose: string;
  status: string;
  amount_pence: number;
  currency: string;
  stripe_checkout_session_id: string | null;
  stripe_payment_intent_id: string | null;
  stripe_setup_intent_id: string | null;
  checkout_url: string | null;
  policy_id: string | null;
  created_at: string;
  updated_at: string;
};

export function rowToPaymentSummary(row: PaymentRow): PaymentSummary {
  return {
    id: row.id,
    reservationId: row.reservation_id,
    status: row.status as PaymentSummary["status"],
    amountPence: row.amount_pence,
    currency: row.currency,
    checkoutUrl: row.checkout_url,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listDepositPolicies(
  env: Env,
  locationId: string
): Promise<DepositPolicyRow[]> {
  const { results } = await env.DB.prepare(
    `SELECT * FROM deposit_policies
     WHERE organization_id = ? AND location_id = ? AND is_active = 1
     ORDER BY priority ASC, created_at ASC`
  )
    .bind(env.ORGANIZATION_ID, locationId)
    .all<DepositPolicyRow>();
  return results ?? [];
}

/**
 * Pick the first active policy matching party, date, period, and day.
 * Server-side only — never trust the client.
 */
export function resolvePolicy(
  policies: DepositPolicyRow[],
  ctx: {
    partySize: number;
    serviceDate: string;
    dayOfWeek: string;
    servicePeriodId: string | null;
  }
): DepositPolicyRow | null {
  const matches = policies
    .filter((p) => p.is_active === 1)
    .filter((p) => p.mode !== "none")
    .filter((p) => ctx.partySize >= p.min_party)
    .filter(
      (p) =>
        !p.service_period_id || p.service_period_id === ctx.servicePeriodId
    )
    .filter((p) => !p.day_of_week || p.day_of_week === ctx.dayOfWeek)
    .filter((p) => !p.date_from || ctx.serviceDate >= p.date_from)
    .filter((p) => !p.date_to || ctx.serviceDate <= p.date_to)
    .sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));

  return matches[0] ?? null;
}

export function depositAmountPence(
  policy: DepositPolicyRow,
  partySize: number
): number {
  if (policy.mode === "deposit_per_person") {
    return policy.amount_pence * partySize;
  }
  if (policy.mode === "deposit_fixed") {
    return policy.amount_pence;
  }
  return 0;
}

export async function createPayment(
  env: Env,
  params: {
    id: string;
    locationId: string;
    reservationId: string;
    contactId: string | null;
    amountPence: number;
    policyId: string;
    checkoutUrl?: string | null;
    stripeCheckoutSessionId?: string | null;
  }
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO payments (
       id, organization_id, location_id, reservation_id, contact_id,
       purpose, status, amount_pence, currency, policy_id,
       checkout_url, stripe_checkout_session_id
     ) VALUES (?, ?, ?, ?, ?, 'deposit', 'requires_action', ?, 'gbp', ?, ?, ?)`
  )
    .bind(
      params.id,
      env.ORGANIZATION_ID,
      params.locationId,
      params.reservationId,
      params.contactId,
      params.amountPence,
      params.policyId,
      params.checkoutUrl ?? null,
      params.stripeCheckoutSessionId ?? null
    )
    .run();
}

export async function linkReservationPayment(
  env: Env,
  reservationId: string,
  paymentId: string,
  depositRequiredPence: number
): Promise<void> {
  await env.DB.prepare(
    `UPDATE reservations
     SET payment_id = ?, deposit_required_pence = ?, updated_at = datetime('now')
     WHERE id = ? AND organization_id = ?`
  )
    .bind(paymentId, depositRequiredPence, reservationId, env.ORGANIZATION_ID)
    .run();
}

export async function getPaymentByReservation(
  env: Env,
  reservationId: string
): Promise<PaymentSummary | null> {
  const row = await env.DB.prepare(
    `SELECT * FROM payments
     WHERE organization_id = ? AND reservation_id = ?
     ORDER BY created_at DESC
     LIMIT 1`
  )
    .bind(env.ORGANIZATION_ID, reservationId)
    .first<PaymentRow>();
  return row ? rowToPaymentSummary(row) : null;
}

export async function getPaymentByCheckoutSession(
  env: Env,
  sessionId: string
): Promise<PaymentRow | null> {
  return env.DB.prepare(
    `SELECT * FROM payments
     WHERE organization_id = ? AND stripe_checkout_session_id = ?`
  )
    .bind(env.ORGANIZATION_ID, sessionId)
    .first<PaymentRow>();
}

export async function updatePaymentCheckout(
  env: Env,
  paymentId: string,
  sessionId: string,
  checkoutUrl: string
): Promise<void> {
  await env.DB.prepare(
    `UPDATE payments
     SET stripe_checkout_session_id = ?, checkout_url = ?, updated_at = datetime('now')
     WHERE id = ? AND organization_id = ?`
  )
    .bind(sessionId, checkoutUrl, paymentId, env.ORGANIZATION_ID)
    .run();
}

export async function markPaymentSucceeded(
  env: Env,
  paymentId: string,
  stripePaymentIntentId: string | null
): Promise<void> {
  await env.DB.prepare(
    `UPDATE payments
     SET status = 'succeeded',
         stripe_payment_intent_id = COALESCE(?, stripe_payment_intent_id),
         captured_at = datetime('now'),
         updated_at = datetime('now')
     WHERE id = ? AND organization_id = ?`
  )
    .bind(stripePaymentIntentId, paymentId, env.ORGANIZATION_ID)
    .run();
}

export async function recordPaymentEvent(
  env: Env,
  params: {
    paymentId: string;
    stripeEventId: string;
    type: string;
    payload: unknown;
  }
): Promise<boolean> {
  const id = crypto.randomUUID();
  try {
    await env.DB.prepare(
      `INSERT INTO payment_events (id, payment_id, stripe_event_id, type, payload_json)
       VALUES (?, ?, ?, ?, ?)`
    )
      .bind(
        id,
        params.paymentId,
        params.stripeEventId,
        params.type,
        JSON.stringify(params.payload)
      )
      .run();
    return true;
  } catch (e) {
    const msg = String(e);
    if (msg.includes("UNIQUE") || msg.includes("unique")) return false;
    throw e;
  }
}

/**
 * Demo seed helper: party >= 6 → deposit_fixed 2000 pence.
 * Call from admin seed or venue onboarding when deposits are enabled.
 */
export async function seedDefaultDepositPolicy(
  env: Env,
  locationId: string
): Promise<string> {
  const id = `dp-default-${locationId}`;
  await env.DB.prepare(
    `INSERT INTO deposit_policies (
       id, organization_id, location_id, name, mode, amount_pence,
       min_party, priority, is_active
     ) VALUES (?, ?, ?, 'Large party deposit', 'deposit_fixed', 2000, 6, 100, 1)
     ON CONFLICT(id) DO UPDATE SET
       mode = excluded.mode,
       amount_pence = excluded.amount_pence,
       min_party = excluded.min_party,
       is_active = 1,
       updated_at = datetime('now')`
  )
    .bind(id, env.ORGANIZATION_ID, locationId)
    .run();
  return id;
}

export async function expirePendingPayments(env: Env): Promise<number> {
  const { results } = await env.DB.prepare(
    `SELECT id FROM reservations
     WHERE organization_id = ?
       AND status = 'pending_payment'
       AND created_at < datetime('now', '-20 minutes')`
  )
    .bind(env.ORGANIZATION_ID)
    .all<{ id: string }>();

  let expired = 0;
  for (const row of results ?? []) {
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE reservations
         SET status = 'expired', updated_at = datetime('now')
         WHERE id = ? AND organization_id = ? AND status = 'pending_payment'`
      ).bind(row.id, env.ORGANIZATION_ID),
      env.DB.prepare(
        `UPDATE payments
         SET status = 'cancelled', updated_at = datetime('now')
         WHERE reservation_id = ? AND organization_id = ?
           AND status = 'requires_action'`
      ).bind(row.id, env.ORGANIZATION_ID),
    ]);
    expired += 1;
  }
  return expired;
}
