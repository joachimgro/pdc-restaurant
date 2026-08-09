import type { Env } from "../env";
import { canonicalPhone } from "../db/phone-utils";
import { sendTelnyxSms } from "../telnyx/send";

/** Booking SMS — Telnyx only. Never Twilio. */
export async function sendBookingSms(
  env: Env,
  to: string,
  body: string
): Promise<{ id: string } | null> {
  const e164 = canonicalPhone(to);
  if (!/^\+[1-9]\d{7,14}$/.test(e164)) {
    throw new Error("The 'to' address should be a single valid number.");
  }
  const { isSmsSuppressed } = await import("./sms-suppression");
  if (await isSmsSuppressed(env, e164)) {
    console.log("[sms] suppressed", e164);
    return null;
  }
  const result = await sendTelnyxSms(env, e164, body);
  if (!result) return null;
  return { id: result.id };
}

const OPT_OUT = " Reply STOP to opt out.";

export function confirmationSmsBody(opts: {
  venueName: string;
  serviceDate: string;
  startTime: string;
  partySize: number;
  reference: string;
  manageUrl: string;
}): string {
  // Keep near one segment; venue name first so the guest knows who texted.
  return `${opts.venueName}: table for ${opts.partySize} on ${opts.serviceDate} at ${opts.startTime}. Ref ${opts.reference}. Manage ${opts.manageUrl}.${OPT_OUT}`;
}

export function reminderSmsBody(opts: {
  venueName: string;
  startTime: string;
  reference: string;
  manageUrl: string;
}): string {
  return `${opts.venueName}: see you at ${opts.startTime} (ref ${opts.reference}). Change/cancel ${opts.manageUrl}.${OPT_OUT}`;
}
