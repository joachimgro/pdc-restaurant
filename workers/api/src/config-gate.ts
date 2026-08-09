import type { Env } from "./env";
import { bookingFromAddress } from "./email/send";

export type ConfigIssue = { code: string; message: string };

/** Canonical Resend sending host for guest/booking mail (override per stamp). */
export function bookingSendingDomain(env: Env): string {
  return (
    env.BOOKING_SENDING_DOMAIN?.trim().toLowerCase() || "bookings.phiof.digital"
  );
}

function emailDomain(addr: string | null | undefined): string | null {
  if (!addr?.trim()) return null;
  const at = addr.lastIndexOf("@");
  if (at <= 0 || at === addr.length - 1) return null;
  return addr.slice(at + 1).trim().toLowerCase();
}

/**
 * When a feature flag is ON, its required secrets must be present.
 * Missing secrets → issues (health 503 + related routes should refuse).
 */
export function collectConfigIssues(env: Env): ConfigIssue[] {
  const issues: ConfigIssue[] = [];
  const demo = env.ENABLE_DEMO_TOOLS === "true";

  if (env.ENABLE_BOOKING_SMS === "true") {
    if (!env.TELNYX_API_KEY?.trim()) {
      issues.push({
        code: "TELNYX_API_KEY",
        message: "ENABLE_BOOKING_SMS requires TELNYX_API_KEY",
      });
    }
    if (
      !env.TELNYX_FROM_NUMBER?.trim() &&
      !env.TELNYX_MESSAGING_PROFILE_ID?.trim()
    ) {
      issues.push({
        code: "TELNYX_FROM",
        message:
          "ENABLE_BOOKING_SMS requires TELNYX_FROM_NUMBER or TELNYX_MESSAGING_PROFILE_ID",
      });
    }
    if (!env.TELNYX_WEBHOOK_PUBLIC_KEY?.trim()) {
      issues.push({
        code: "TELNYX_WEBHOOK_PUBLIC_KEY",
        message:
          "ENABLE_BOOKING_SMS requires TELNYX_WEBHOOK_PUBLIC_KEY so STOP/START inbound works",
      });
    }
  }

  if (env.ENABLE_DEPOSITS === "true") {
    if (!env.STRIPE_SECRET_KEY?.trim()) {
      issues.push({
        code: "STRIPE_SECRET_KEY",
        message: "ENABLE_DEPOSITS requires STRIPE_SECRET_KEY",
      });
    }
    if (!env.STRIPE_WEBHOOK_SECRET?.trim()) {
      issues.push({
        code: "STRIPE_WEBHOOK_SECRET",
        message: "ENABLE_DEPOSITS requires STRIPE_WEBHOOK_SECRET",
      });
    }
  }

  if (env.ENABLE_SERVICE === "true" && !demo) {
    if (!env.TURNSTILE_SECRET_KEY?.trim()) {
      issues.push({
        code: "TURNSTILE_SECRET_KEY",
        message:
          "ENABLE_SERVICE (non-demo) requires TURNSTILE_SECRET_KEY for public book writes",
      });
    }
    if (!env.RATE_LIMITS) {
      issues.push({
        code: "RATE_LIMITS",
        message:
          "ENABLE_SERVICE (non-demo) requires RATE_LIMITS KV for public book writes",
      });
    }
    if (!env.RESEND_API_KEY?.trim()) {
      issues.push({
        code: "RESEND_API_KEY",
        message:
          "ENABLE_SERVICE (non-demo) requires RESEND_API_KEY for booking email",
      });
    }

    const expected = bookingSendingDomain(env);
    const from = bookingFromAddress(env);
    const domain = emailDomain(from);
    if (!domain || domain !== expected) {
      issues.push({
        code: "BOOKING_FROM_DOMAIN",
        message: `BOOKING_FROM_EMAIL must be on @${expected} (got ${from})`,
      });
    }

    const authFrom = env.AUTH_FROM_EMAIL?.trim();
    if (authFrom) {
      const authDomain = emailDomain(authFrom);
      if (!authDomain || authDomain !== expected) {
        issues.push({
          code: "AUTH_FROM_DOMAIN",
          message: `AUTH_FROM_EMAIL must be on @${expected} (got ${authFrom})`,
        });
      }
    }
  }

  return issues;
}

export function assertConfigForBookingSms(env: Env): ConfigIssue | null {
  return (
    collectConfigIssues(env).find((i) => i.code.startsWith("TELNYX")) ?? null
  );
}
