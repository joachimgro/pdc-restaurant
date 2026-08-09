import type { Env } from "../env";

/**
 * Cloudflare Turnstile siteverify.
 *
 * - Secret unset + ENABLE_DEMO_TOOLS → allow (local/demo without keys)
 * - ENABLE_DEMO_TOOLS + no token → allow (staff demos / local book UI)
 * - Secret set + token present → always verify (never skip a submitted token)
 * - Secret set + no token + demo off → TURNSTILE_REQUIRED
 */
export async function verifyTurnstile(
  env: Env,
  token: string | undefined | null,
  ip: string | null
): Promise<{ ok: true } | { ok: false; code: string; error: string }> {
  const secret = env.TURNSTILE_SECRET_KEY?.trim();
  const demo = env.ENABLE_DEMO_TOOLS === "true";
  const trimmed = token?.trim() || "";

  if (!secret) {
    if (demo) return { ok: true };
    return {
      ok: false,
      code: "TURNSTILE_NOT_CONFIGURED",
      error: "Booking protection is not configured",
    };
  }

  if (!trimmed) {
    if (demo) return { ok: true };
    return {
      ok: false,
      code: "TURNSTILE_REQUIRED",
      error: "Please complete the security check",
    };
  }

  const form = new FormData();
  form.set("secret", secret);
  form.set("response", trimmed);
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
