import type { Env } from "../env";

/**
 * Channel-agnostic webhook idempotency gate.
 *
 * Records a webhook delivery keyed on (provider, external_id) using
 * INSERT OR IGNORE so concurrent duplicates are handled atomically by the
 * UNIQUE(provider, external_id) constraint — no SELECT-then-INSERT race.
 *
 * `provider` is the channel identifier: "twilio", "telnyx", "meta_instagram",
 * "meta_whatsapp", etc. Every channel handler should call this same utility so
 * future plugins inherit dedup automatically.
 *
 * Returns { isDuplicate: true } when the delivery was already recorded — the
 * caller should acknowledge with HTTP 200 (not 4xx) to stop the provider
 * retrying, and skip processing.
 */
export async function recordWebhookDelivery(
  env: Env,
  provider: string,
  externalId: string
): Promise<{ isDuplicate: boolean }> {
  const result = await env.DB.prepare(
    `INSERT OR IGNORE INTO webhook_deliveries (id, provider, external_id)
     VALUES (?, ?, ?)`
  )
    .bind(crypto.randomUUID(), provider, externalId)
    .run();

  return { isDuplicate: (result.meta.changes ?? 0) === 0 };
}

/**
 * Remove a previously-recorded delivery so a provider retry can re-process it.
 * Used when domain writes fail AFTER the delivery was recorded, so the message
 * is not silently lost (the system self-heals on the provider's retry).
 */
export async function deleteWebhookDelivery(
  env: Env,
  provider: string,
  externalId: string
): Promise<void> {
  await env.DB.prepare(
    `DELETE FROM webhook_deliveries WHERE provider = ? AND external_id = ?`
  )
    .bind(provider, externalId)
    .run();
}
