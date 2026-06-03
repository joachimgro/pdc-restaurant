import type { Env } from "../env";
import { generateToken, hashToken, isExpired, nowPlusMinutes } from "./tokens";

const MAGIC_LINK_TTL_MINUTES = 15;
const RATE_LIMIT_SECONDS = 60;

interface MagicLinkRow {
  token_hash: string;
  email: string;
  expires_at: string;
  used_at: string | null;
}

/**
 * Request a magic link for the given email.
 * - Checks the email is a registered admin.
 * - Rate-limits to one request per 60 seconds.
 * - Generates a token, stores its hash, sends the email via Resend.
 *
 * Returns "ok" on success, or a user-facing error string.
 * Never reveals whether the email exists (to prevent enumeration).
 */
export async function requestMagicLink(
  env: Env,
  email: string
): Promise<{ ok: true } | { error: string; status: number }> {
  const normalised = email.toLowerCase().trim();

  // Check admin exists — do this silently to avoid email enumeration
  const admin = await env.DB.prepare(
    `SELECT email FROM admins WHERE email = ?`
  )
    .bind(normalised)
    .first<{ email: string }>();

  if (!admin) {
    // Return success to prevent enumeration
    return { ok: true };
  }

  // Rate limit: reject if there's an unexpired, unused link requested in the last 60s
  const recent = await env.DB.prepare(
    `SELECT expires_at FROM magic_links
     WHERE email = ?
       AND used_at IS NULL
       AND expires_at > datetime('now', ?)
     LIMIT 1`
  )
    .bind(
      normalised,
      `+${MAGIC_LINK_TTL_MINUTES - RATE_LIMIT_SECONDS / 60} minutes`
    )
    .first<{ expires_at: string }>();

  if (recent) {
    return {
      error: "A sign-in link was recently sent. Please wait a moment before requesting another.",
      status: 429,
    };
  }

  // Generate and store the token
  const raw = generateToken();
  const hash = await hashToken(raw);
  const expiresAt = nowPlusMinutes(MAGIC_LINK_TTL_MINUTES);

  await env.DB.prepare(
    `INSERT INTO magic_links (token_hash, email, expires_at) VALUES (?, ?, ?)`
  )
    .bind(hash, normalised, expiresAt)
    .run();

  // Build magic link URL
  const appUrl = (env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  const magicUrl = `${appUrl}/auth/verify?token=${encodeURIComponent(raw)}`;

  // Send email via Resend
  const sent = await sendMagicLinkEmail(env, normalised, magicUrl);
  if (!sent) {
    return { error: "Failed to send sign-in email. Please try again.", status: 500 };
  }

  return { ok: true };
}

/**
 * Verify a magic link token.
 * Returns the email on success, or null if the token is invalid/expired/used.
 * Marks the token as used on success (single-use).
 */
export async function verifyMagicLink(
  env: Env,
  rawToken: string
): Promise<string | null> {
  const hash = await hashToken(rawToken);

  const row = await env.DB.prepare(
    `SELECT email, expires_at, used_at FROM magic_links WHERE token_hash = ?`
  )
    .bind(hash)
    .first<MagicLinkRow>();

  if (!row) return null;
  if (row.used_at) return null;
  if (isExpired(row.expires_at)) return null;

  // Mark as used
  await env.DB.prepare(
    `UPDATE magic_links SET used_at = datetime('now') WHERE token_hash = ?`
  )
    .bind(hash)
    .run();

  return row.email;
}

async function sendMagicLinkEmail(
  env: Env,
  to: string,
  magicUrl: string
): Promise<boolean> {
  const apiKey = env.RESEND_API_KEY;
  const from = env.RESEND_FROM_EMAIL ?? "noreply@example.com";

  if (!apiKey) {
    // In local dev without a key, log the link instead of failing
    console.log(`[DEV] Magic link for ${to}: ${magicUrl}`);
    return true;
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [to],
        subject: "Your sign-in link",
        html: buildEmailHtml(magicUrl),
        text: buildEmailText(magicUrl),
      }),
    });

    if (!res.ok) {
      console.error("Resend error:", res.status, await res.text());
      return false;
    }

    return true;
  } catch (e) {
    console.error("Resend fetch error:", e);
    return false;
  }
}

function buildEmailHtml(magicUrl: string): string {
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#fafaf7;margin:0;padding:40px 20px">
  <div style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:8px;border:1px solid #e8e6e0;padding:40px">
    <p style="font-size:16px;color:#1a1a1a;margin:0 0 24px">Here's your sign-in link. It expires in 15 minutes and can only be used once.</p>
    <a href="${magicUrl}"
       style="display:inline-block;background:#1a1a1a;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:6px;font-size:15px;font-weight:500">
      Sign in
    </a>
    <p style="font-size:13px;color:#7a766f;margin:24px 0 0">
      If you didn't request this, you can ignore this email safely.
    </p>
  </div>
</body>
</html>`;
}

function buildEmailText(magicUrl: string): string {
  return `Sign in using this link (expires in 15 minutes, single use):\n\n${magicUrl}\n\nIf you didn't request this, ignore this email.`;
}
