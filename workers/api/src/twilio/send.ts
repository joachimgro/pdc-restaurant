import type { Env } from "../env";
import {
  basicAuthHeader,
  resolveTwilioCreds,
  twilioConfigured,
} from "./credentials";

export { twilioConfigured };

export interface SendSmsResult {
  sid: string;
  status: string;
}

/** Send outbound SMS via Twilio REST API (required for programmatic texts). */
export async function sendTwilioSms(
  env: Env,
  to: string,
  body: string
): Promise<SendSmsResult | null> {
  const creds = resolveTwilioCreds(env);
  if (!creds) {
    console.warn("Twilio not configured — skipping outbound SMS");
    return null;
  }

  const form = new URLSearchParams();
  form.set("To", to);
  form.set("Body", body);

  if (creds.messagingServiceSid) {
    form.set("MessagingServiceSid", creds.messagingServiceSid);
  } else if (creds.fromNumber) {
    form.set("From", creds.fromNumber);
  }

  const url = `https://api.twilio.com/2010-04-01/Accounts/${creds.accountSid}/Messages.json`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: basicAuthHeader(creds.authUser, creds.authPass),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form.toString(),
  });

  const data = (await res.json()) as {
    sid?: string;
    status?: string;
    message?: string;
    code?: number;
  };

  if (!res.ok) {
    console.error("Twilio send failed", {
      code: data.code,
      message: data.message,
      status: res.status,
      accountSidPrefix: creds.accountSid.slice(0, 6),
      authMode: creds.authUser.startsWith("SK") ? "api_key" : "auth_token",
    });
    throw new Error(data.message ?? `Twilio error ${res.status}`);
  }

  return {
    sid: data.sid ?? "",
    status: data.status ?? "queued",
  };
}
