import { jsonResponse } from "../cors";
import { processInboundSms, queueInboundAi } from "../db/inbound-sms";
import { verifyTelnyxWebhook } from "../auth/telnyx-verify";
import { logger } from "../log";
import type { Env } from "../env";
import {
  parseSmsKeyword,
  suppressSmsPhone,
  unsuppressSmsPhone,
} from "../notifications/sms-suppression";

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
    logger.error(env, "TELNYX_WEBHOOK_PUBLIC_KEY not set — rejecting webhook", {
      hint: "wrangler secret put TELNYX_WEBHOOK_PUBLIC_KEY",
    });
    return new Response("Webhook verification not configured", { status: 500 });
  }

  const valid = await verifyTelnyxWebhook(request, env.TELNYX_WEBHOOK_PUBLIC_KEY);
  if (!valid) {
    logger.warn(env, "Telnyx webhook signature invalid — rejecting");
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

  // Booking-line STOP / START — maintain suppression before any CRM/AI work.
  const keyword = parseSmsKeyword(text);
  if (keyword === "stop") {
    await suppressSmsPhone(env, fromPhone, "stop");
    return jsonResponse(request, env, { ok: true, suppressed: true });
  }
  if (keyword === "start") {
    await unsuppressSmsPhone(env, fromPhone);
    return jsonResponse(request, env, { ok: true, unsuppressed: true });
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
