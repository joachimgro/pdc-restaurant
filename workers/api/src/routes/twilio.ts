import { processInboundSms, queueInboundAi } from "../db/inbound-sms";
import type { Env } from "../env";
import {
  parseTwilioForm,
  twilioEmptyResponse,
  validateTwilioSignature,
} from "../twilio/validate";

async function readAndVerifyTwilio(
  request: Request,
  env: Env
): Promise<{ params: Record<string, string> } | Response> {
  const rawBody = await request.text();
  const params = parseTwilioForm(rawBody);

  const signature = request.headers.get("X-Twilio-Signature") ?? "";
  const skipVerify =
    env.TWILIO_SKIP_SIGNATURE_VALIDATION === "true" ||
    env.TWILIO_SKIP_SIGNATURE_VALIDATION === "1";

  if (env.TWILIO_AUTH_TOKEN && !skipVerify) {
    const url = new URL(request.url);
    const validationUrl = `${url.origin}${url.pathname}`;

    const valid = await validateTwilioSignature(
      env.TWILIO_AUTH_TOKEN,
      signature,
      validationUrl,
      params
    );

    if (!valid) {
      console.error("Invalid Twilio signature", validationUrl);
      return new Response("Forbidden", { status: 403 });
    }
  } else if (!env.TWILIO_AUTH_TOKEN) {
    console.warn("TWILIO_AUTH_TOKEN not set — skipping signature validation");
  }

  return { params };
}

/** Inbound SMS — Messaging Service webhook */
export async function handleTwilioInbound(
  request: Request,
  env: Env
): Promise<Response> {
  const verified = await readAndVerifyTwilio(request, env);
  if (verified instanceof Response) return verified;

  const { params } = verified;
  const messageSid = params.MessageSid ?? params.SmsMessageSid ?? "";
  const from = params.From ?? "";
  const body = params.Body ?? "";

  if (!messageSid) {
    return twilioEmptyResponse();
  }

  // Status-only callbacks sometimes hit the same URL
  if (!body && params.SmsStatus) {
    return twilioEmptyResponse();
  }

  const result = await processInboundSms(env, {
    phone: from,
    text: body,
    externalId: messageSid,
    provider: "twilio",
    source: "SMS",
  });

  if (!result.skipped && result.leadId && result.messageId) {
    await queueInboundAi(env, result.leadId, result.messageId);
  }

  return twilioEmptyResponse();
}

/** Delivery status callback (optional second URL in Twilio console) */
export async function handleTwilioStatus(
  request: Request,
  env: Env
): Promise<Response> {
  const verified = await readAndVerifyTwilio(request, env);
  if (verified instanceof Response) return verified;

  const { params } = verified;
  const sid = params.MessageSid ?? "";
  const status = params.MessageStatus ?? params.SmsStatus ?? "";

  if (sid && status) {
    console.log(`Twilio status: ${sid} → ${status}`);
    // Future: persist delivery status on messages table
  }

  return twilioEmptyResponse();
}
