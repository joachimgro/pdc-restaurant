import type { Env } from "../env";

/**
 * Cloudflare Turnstile siteverify.
 * Bypass only when secret unset AND ENABLE_DEMO_TOOLS=true.
 * Never bypass when the secret is set.
 */
export async function verifyTurnstile(
  env: Env,
  token: string | undefined | null,
  ip: string | null
): Promise<{ ok: true } | { ok: false; code: string; error: string }> {
  const secret = env.TURNSTILE_SECRET_KEY?.trim();
  if (!secret) {
    if (env.ENABLE_DEMO_TOOLS === "true") {
      return { ok: true };
    }
    return {
      ok: false,
      code: "TURNSTILE_NOT_CONFIGURED",
      error: "Booking protection is not configured",
    };
  }

  if (!token?.trim()) {
    return {
      ok: false,
      code: "TURNSTILE_REQUIRED",
      error: "Please complete the security check",
    };
  }

  const form = new FormData();
  form.set("secret", secret);
  form.set("response", token.trim());
  if (ip) form.set("remoteip", ip);

  const res = await fetch(
    "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    { method: "POST", body: form }
  );
  const data = (await res.json()) as { success?: boolean; "error-codes"?: string[] };
  if (!data.success) {
    return {
      ok: false,
      code: "TURNSTILE_FAILED",
      error: "Security check failed — try again",
    };
  }
  return { ok: true };
}
