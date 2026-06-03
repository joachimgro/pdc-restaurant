import { jsonResponse } from "../cors";
import { processInboundSms, queueInboundAi } from "../db/inbound-sms";
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
