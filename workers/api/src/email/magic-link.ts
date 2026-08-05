import type { Env } from "../env";
import { sendEmail } from "./send";

/**
 * Staff magic-link email. Uses the shared Resend caller; layout stays the
 * Soft Bubble staff look so auth UX does not change.
 */
export async function sendMagicLinkEmail(
  env: Env,
  to: string,
  verifyUrl: string
): Promise<void> {
  const subject = "Sign in to Lead Intake";
  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
</head>
<body style="margin:0;padding:0;background:#0E0F12;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0E0F12;padding:40px 16px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#1A1C20;border-radius:20px;padding:40px 32px;">
          <tr>
            <td style="text-align:center;padding-bottom:24px;">
              <div style="display:inline-block;width:48px;height:48px;background:#FF6B6B;border-radius:14px;line-height:48px;color:#fff;font-weight:800;font-size:20px;">L</div>
            </td>
          </tr>
          <tr>
            <td style="color:#F3F4F6;font-size:22px;font-weight:700;text-align:center;padding-bottom:8px;">
              Sign in to Lead Intake
            </td>
          </tr>
          <tr>
            <td style="color:#82858E;font-size:14px;line-height:1.6;text-align:center;padding-bottom:28px;">
              Tap the button below to open your inbox. This link expires in 15 minutes and can only be used once.
            </td>
          </tr>
          <tr>
            <td align="center" style="padding-bottom:28px;">
              <a href="${escapeAttr(verifyUrl)}" style="display:inline-block;background:#FF6B6B;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:14px 32px;border-radius:999px;">
                Sign in
              </a>
            </td>
          </tr>
          <tr>
            <td style="color:#555;font-size:11px;line-height:1.5;text-align:center;word-break:break-all;">
              Or copy this link:<br/>
              <span style="color:#82858E;">${escapeAttr(verifyUrl)}</span>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const text = `Sign in to Lead Intake\n\n${verifyUrl}\n\nThis link expires in 15 minutes.`;
  await sendEmail(env, { to, subject, html, text });
}

function escapeAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
