import type { Env } from "../env";

export function telnyxConfigured(env: Env): boolean {
  return Boolean(env.TELNYX_API_KEY?.trim());
}

export interface SendTelnyxSmsResult {
  id: string;
  status: string;
}

/** Send outbound SMS via Telnyx Messaging API v2. Ported from pdc-phiof. */
export async function sendTelnyxSms(
  env: Env,
  to: string,
  body: string
): Promise<SendTelnyxSmsResult | null> {
  const apiKey = env.TELNYX_API_KEY?.trim();
  if (!apiKey) {
    console.warn("Telnyx not configured — skipping outbound SMS");
    return null;
  }

  const from = env.TELNYX_FROM_NUMBER?.trim();
  const profileId = env.TELNYX_MESSAGING_PROFILE_ID?.trim();
  if (!from && !profileId) {
    console.warn(
      "Telnyx outbound not configured — set TELNYX_FROM_NUMBER or TELNYX_MESSAGING_PROFILE_ID"
    );
    return null;
  }

  const payload: Record<string, string> = { to, text: body };
  if (from) payload.from = from;
  if (profileId) payload.messaging_profile_id = profileId;

  const res = await fetch("https://api.telnyx.com/v2/messages", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const data = (await res.json()) as {
    data?: { id?: string; status?: string };
    errors?: { detail?: string; title?: string }[];
  };

  if (!res.ok) {
    const err = data.errors?.[0];
    console.error("Telnyx send failed", {
      status: res.status,
      detail: err?.detail ?? err?.title,
    });
    throw new Error(err?.detail ?? err?.title ?? `Telnyx error ${res.status}`);
  }

  return {
    id: data.data?.id ?? "",
    status: data.data?.status ?? "queued",
  };
}
