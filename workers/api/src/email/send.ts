import type { Env } from "../env";

export type SendEmailParams = {
  to: string;
  subject: string;
  html: string;
  text: string;
  replyTo?: string | null;
};

export type SendEmailResult = { id: string } | null;

/**
 * Generic Resend caller. Missing keys → warn and skip (no throw), matching
 * magic-link behaviour so local demos still work without Resend.
 */
export async function sendEmail(
  env: Env,
  params: SendEmailParams
): Promise<SendEmailResult> {
  const apiKey = env.RESEND_API_KEY?.trim();
  const from = env.AUTH_FROM_EMAIL?.trim();
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

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(err.message ?? `Resend error ${res.status}`);
  }

  const data = (await res.json().catch(() => ({}))) as { id?: string };
  return { id: data.id ?? "" };
}
