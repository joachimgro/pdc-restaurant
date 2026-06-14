import { jsonResponse } from "../cors";
import { processInboundSms, queueInboundAi } from "../db/inbound-sms";
import { verifyTelnyxWebhook } from "../auth/telnyx-verify";
import type { Env } from "../env";

interface TelnyxPayload {
  data?: {
    event_type?: string;
    id?: string;
    payload?: {
      from?: { phone_number?: string };
      to?: { phone_number?: string }[];
      text?: string;
    };
  };
}

/** Telnyx inbound SMS — returns 200 immediately, AI runs on queue */
export async function handleTelnyxWebhook(
  request: Request,
  env: Env
): Promise<Response> {
  // ── Signature verification — mandatory ───────────────────────────────────
  if (!env.TELNYX_WEBHOOK_PUBLIC_KEY) {
    console.error(
      `[${env.ORGANIZATION_ID}] TELNYX_WEBHOOK_PUBLIC_KEY not set — rejecting webhook. ` +
        "Set the secret: wrangler secret put TELNYX_WEBHOOK_PUBLIC_KEY"
    );
    return new Response("Webhook verification not configured", { status: 500 });
  }

  const valid = await verifyTelnyxWebhook(request, env.TELNYX_WEBHOOK_PUBLIC_KEY);
  if (!valid) {
    console.warn(
      `[${env.ORGANIZATION_ID}] Telnyx webhook signature invalid — rejecting`
    );
    return new Response("Invalid signature", { status: 403 });
  }

  // ── Parse body (already consumed by .clone() in verifyTelnyxWebhook) ─────
  let body: TelnyxPayload;
  try {
    body = (await request.json()) as TelnyxPayload;
  } catch {
    return jsonResponse(request, env, { error: "Invalid JSON" }, 400);
  }

  const eventId = body.data?.id ?? crypto.randomUUID();
  const text = body.data?.payload?.text ?? "";
  const fromPhone = body.data?.payload?.from?.phone_number ?? "";

  if (!text || !fromPhone) {
    return jsonResponse(request, env, { ok: true, skipped: true });
  }

  const result = await processInboundSms(env, {
    phone: fromPhone,
    text,
    externalId: eventId,
    provider: "telnyx",
    source: "SMS",
  });

  if (!result.skipped && result.leadId && result.messageId) {
    await queueInboundAi(env, result.leadId, result.messageId);
  }

  return jsonResponse(request, env, {
    ok: true,
    leadId: result.leadId,
    queued: !result.skipped,
  });
}
