export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export type BrandBits = {
  venueName: string;
  accent?: string | null;
  logoUrl?: string | null;
  addressText?: string | null;
  contactPhone?: string | null;
};

/** Shared shell for venue-branded transactional emails. Light, guest-facing. */
export function emailLayout(
  brand: BrandBits,
  innerHtml: string
): string {
  const accent = brand.accent?.trim() || "#1a1a1a";
  const venueName = brand.venueName?.trim() || "Restaurant";
  const logo = brand.logoUrl
    ? `<img src="${escapeHtml(brand.logoUrl)}" alt="" width="48" height="48" style="border-radius:12px;display:block;margin:0 auto 16px;" />`
    : `<div style="display:inline-block;width:48px;height:48px;background:${escapeHtml(accent)};border-radius:12px;line-height:48px;color:#fff;font-weight:700;font-size:18px;text-align:center;">${escapeHtml(venueName.charAt(0).toUpperCase())}</div>`;

  const footerParts = [
    escapeHtml(venueName),
    brand.addressText ? escapeHtml(brand.addressText) : null,
    brand.contactPhone ? escapeHtml(brand.contactPhone) : null,
  ].filter(Boolean);

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
</head>
<body style="margin:0;padding:0;background:#f5f5f4;font-family:Georgia,'Times New Roman',serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f4;padding:40px 16px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:4px;padding:36px 28px;">
          <tr>
            <td style="text-align:center;padding-bottom:20px;">${logo}</td>
          </tr>
          <tr>
            <td style="color:#1a1a1a;font-size:13px;letter-spacing:0.04em;text-transform:uppercase;text-align:center;padding-bottom:20px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
              ${escapeHtml(venueName)}
            </td>
          </tr>
          <tr>
            <td style="color:#1a1a1a;font-size:16px;line-height:1.6;">
              ${innerHtml}
            </td>
          </tr>
          <tr>
            <td style="color:#78716c;font-size:12px;line-height:1.5;text-align:center;padding-top:28px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
              ${footerParts.join("<br/>")}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
