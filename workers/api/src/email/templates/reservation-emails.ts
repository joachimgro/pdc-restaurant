import { emailLayout, escapeHtml, type BrandBits } from "../layout";

export type ReservationEmailPayload = {
  guestName: string;
  reference: string;
  serviceDate: string;
  startTime: string;
  partySize: number;
  manageUrl: string;
  venueName: string;
  addressText?: string | null;
  contactPhone?: string | null;
  brand?: BrandBits;
};

function brandOf(p: ReservationEmailPayload): BrandBits {
  const raw = (p.brand ?? {}) as Record<string, unknown>;
  const fromBrand =
    typeof raw.venueName === "string"
      ? raw.venueName
      : typeof raw.displayName === "string"
        ? raw.displayName
        : typeof raw.name === "string"
          ? raw.name
          : "";
  return {
    venueName: fromBrand.trim() || p.venueName || "Restaurant",
    accent: typeof raw.accent === "string" ? raw.accent : null,
    logoUrl: typeof raw.logoUrl === "string" ? raw.logoUrl : null,
    addressText:
      (typeof raw.addressText === "string" ? raw.addressText : null) ??
      p.addressText ??
      null,
    contactPhone:
      (typeof raw.contactPhone === "string" ? raw.contactPhone : null) ??
      p.contactPhone ??
      null,
  };
}

export function reservationConfirmedEmail(p: ReservationEmailPayload): {
  subject: string;
  html: string;
  text: string;
} {
  const subject = `You're booked at ${p.venueName} — ${p.reference}`;
  const inner = `
    <p style="margin:0 0 16px;font-size:22px;font-weight:600;">You're booked</p>
    <p style="margin:0 0 12px;">Hi ${escapeHtml(p.guestName)},</p>
    <p style="margin:0 0 16px;">We have you down for <strong>${escapeHtml(String(p.partySize))}</strong> on <strong>${escapeHtml(p.serviceDate)}</strong> at <strong>${escapeHtml(p.startTime)}</strong>.</p>
    <p style="margin:0 0 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:14px;">Reference: <strong>${escapeHtml(p.reference)}</strong></p>
    <p style="margin:0 0 24px;text-align:center;">
      <a href="${escapeHtml(p.manageUrl)}" style="display:inline-block;background:#1a1a1a;color:#fff;text-decoration:none;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:14px;font-weight:600;padding:14px 28px;border-radius:4px;">Manage booking</a>
    </p>
    <p style="margin:0;color:#57534e;font-size:14px;">Need to change or cancel? Use the link above — no account needed.</p>
  `;
  const text = [
    `You're booked at ${p.venueName}`,
    `Hi ${p.guestName},`,
    `Party of ${p.partySize} on ${p.serviceDate} at ${p.startTime}.`,
    `Reference: ${p.reference}`,
    `Manage: ${p.manageUrl}`,
  ].join("\n\n");
  return { subject, html: emailLayout(brandOf(p), inner), text };
}

export function reservationReminderEmail(p: ReservationEmailPayload): {
  subject: string;
  html: string;
  text: string;
} {
  const subject = `Tomorrow at ${p.venueName} — ${p.startTime}`;
  const inner = `
    <p style="margin:0 0 16px;font-size:22px;font-weight:600;">See you soon</p>
    <p style="margin:0 0 12px;">Hi ${escapeHtml(p.guestName)},</p>
    <p style="margin:0 0 16px;">Just a reminder — your table for <strong>${escapeHtml(String(p.partySize))}</strong> is on <strong>${escapeHtml(p.serviceDate)}</strong> at <strong>${escapeHtml(p.startTime)}</strong>.</p>
    <p style="margin:0 0 24px;text-align:center;">
      <a href="${escapeHtml(p.manageUrl)}" style="display:inline-block;background:#1a1a1a;color:#fff;text-decoration:none;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:14px;font-weight:600;padding:14px 28px;border-radius:4px;">Manage booking</a>
    </p>
  `;
  const text = [
    `Reminder: ${p.venueName}`,
    `Party of ${p.partySize} on ${p.serviceDate} at ${p.startTime}.`,
    `Reference: ${p.reference}`,
    `Manage: ${p.manageUrl}`,
  ].join("\n\n");
  return { subject, html: emailLayout(brandOf(p), inner), text };
}

export function reservationChangedEmail(p: ReservationEmailPayload): {
  subject: string;
  html: string;
  text: string;
} {
  const subject = `Booking updated — ${p.venueName} ${p.reference}`;
  const inner = `
    <p style="margin:0 0 16px;font-size:22px;font-weight:600;">Booking updated</p>
    <p style="margin:0 0 12px;">Hi ${escapeHtml(p.guestName)},</p>
    <p style="margin:0 0 16px;">Your booking is now <strong>${escapeHtml(String(p.partySize))}</strong> on <strong>${escapeHtml(p.serviceDate)}</strong> at <strong>${escapeHtml(p.startTime)}</strong>.</p>
    <p style="margin:0 0 24px;text-align:center;">
      <a href="${escapeHtml(p.manageUrl)}" style="display:inline-block;background:#1a1a1a;color:#fff;text-decoration:none;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:14px;font-weight:600;padding:14px 28px;border-radius:4px;">Manage booking</a>
    </p>
  `;
  const text = [
    `Booking updated at ${p.venueName}`,
    `Party of ${p.partySize} on ${p.serviceDate} at ${p.startTime}.`,
    `Reference: ${p.reference}`,
    `Manage: ${p.manageUrl}`,
  ].join("\n\n");
  return { subject, html: emailLayout(brandOf(p), inner), text };
}

export function reservationCancelledEmail(p: ReservationEmailPayload): {
  subject: string;
  html: string;
  text: string;
} {
  const subject = `Booking cancelled — ${p.venueName} ${p.reference}`;
  const inner = `
    <p style="margin:0 0 16px;font-size:22px;font-weight:600;">Booking cancelled</p>
    <p style="margin:0 0 12px;">Hi ${escapeHtml(p.guestName)},</p>
    <p style="margin:0 0 16px;">We've cancelled your table for <strong>${escapeHtml(p.serviceDate)}</strong> at <strong>${escapeHtml(p.startTime)}</strong> (ref ${escapeHtml(p.reference)}).</p>
    ${
      p.contactPhone
        ? `<p style="margin:0;color:#57534e;font-size:14px;">Questions? Call us on ${escapeHtml(p.contactPhone)}.</p>`
        : ""
    }
  `;
  const text = [
    `Booking cancelled at ${p.venueName}`,
    `${p.serviceDate} at ${p.startTime}, ref ${p.reference}.`,
    p.contactPhone ? `Call: ${p.contactPhone}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
  return { subject, html: emailLayout(brandOf(p), inner), text };
}
