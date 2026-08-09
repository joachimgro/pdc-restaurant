import type { Env } from "../env";

export type SendEmailParams = {
  to: string;
  subject: string;
  html: string;
  text: string;
  replyTo?: string | null;
  /** Override From (defaults to AUTH_FROM_EMAIL). */
  from?: string | null;
  /** Resend Idempotency-Key — prevents duplicate sends on retry/crash. */
  idempotencyKey?: string | null;
};

export type SendEmailResult = { id: string } | null;

/** Staff auth / magic-link sender. */
export function authFromAddress(env: Env): string | null {
  return env.AUTH_FROM_EMAIL?.trim() || null;
}

/**
 * Guest booking + contact sender/receiver.
 * Defaults to admin@bookings.phiof.digital when BOOKING_FROM_EMAIL is unset.
 */
export function bookingFromAddress(env: Env): string {
  return (
    env.BOOKING_FROM_EMAIL?.trim() ||
    "admin@bookings.phiof.digital"
  );
}

/**
 * Generic Resend caller. Missing keys → warn and skip (no throw), matching
 * magic-link behaviour so local demos still work without Resend.
 */
export async function sendEmail(
  env: Env,
  params: SendEmailParams
): Promise<SendEmailResult> {
  const apiKey = env.RESEND_API_KEY?.trim();
  const from = (params.from?.trim() || authFromAddress(env)) ?? null;
  if (!apiKey || !from) {
    console.warn("Resend not configured — skipping email to", params.to);
    return null;
  }

  const body: Record<string, unknown> = {
    from,
    to: [params.to],
    subject: params.subject,
    html: params.html,
    text: params.text,
  };
  if (params.replyTo?.trim()) body.reply_to = params.replyTo.trim();

  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
  if (params.idempotencyKey?.trim()) {
    headers["Idempotency-Key"] = params.idempotencyKey.trim();
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(err.message ?? `Resend error ${res.status}`);
  }

  const data = (await res.json().catch(() => ({}))) as { id?: string };
  return { id: data.id ?? "" };
}

/** Outbound guest/booking mail — always from BOOKING_FROM_EMAIL. */
export async function sendBookingEmail(
  env: Env,
  params: Omit<SendEmailParams, "from" | "replyTo"> & {
    replyTo?: string | null;
  }
): Promise<SendEmailResult> {
  const from = bookingFromAddress(env);
  return sendEmail(env, {
    ...params,
    from,
    replyTo: params.replyTo ?? from,
  });
}
