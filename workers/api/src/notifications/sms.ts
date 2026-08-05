import type { Env } from "../env";
import { sendTelnyxSms } from "../telnyx/send";

/** Booking SMS — Telnyx only. Never Twilio. */
export async function sendBookingSms(
  env: Env,
  to: string,
  body: string
): Promise<{ id: string } | null> {
  const result = await sendTelnyxSms(env, to, body);
  if (!result) return null;
  return { id: result.id };
}

export function confirmationSmsBody(opts: {
  venueName: string;
  serviceDate: string;
  startTime: string;
  partySize: number;
  reference: string;
  manageUrl: string;
}): string {
  // Keep near one segment; venue name first so the guest knows who texted.
  return `${opts.venueName}: table for ${opts.partySize} on ${opts.serviceDate} at ${opts.startTime}. Ref ${opts.reference}. Manage ${opts.manageUrl}`;
}

export function reminderSmsBody(opts: {
  venueName: string;
  startTime: string;
  reference: string;
  manageUrl: string;
}): string {
  return `${opts.venueName}: see you at ${opts.startTime} (ref ${opts.reference}). Change/cancel ${opts.manageUrl}`;
}
