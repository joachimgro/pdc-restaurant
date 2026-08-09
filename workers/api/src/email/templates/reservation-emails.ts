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
  const b = p.brand as
    | (BrandBits & { displayName?: string; name?: string })
    | undefined
    | null;
  const fromBrand =
    (typeof b?.venueName === "string" && b.venueName.trim()) ||
    (typeof b?.displayName === "string" && b.displayName.trim()) ||
    (typeof b?.name === "string" && b.name.trim()) ||
    "";
  return {
    venueName: fromBrand || p.venueName || "Restaurant",
    accent: typeof b?.accent === "string" ? b.accent : null,
    logoUrl: typeof b?.logoUrl === "string" ? b.logoUrl : null,
    addressText:
      p.addressText ??
      (typeof b?.addressText === "string" ? b.addressText : null),
    contactPhone:
      p.contactPhone ??
      (typeof b?.contactPhone === "string" ? b.contactPhone : null),
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

export type ReviewRequestEmailPayload = ReservationEmailPayload & {
  reviewUrl: string;
};

export function reviewRequestEmail(p: ReviewRequestEmailPayload): {
  subject: string;
  html: string;
  text: string;
} {
  const subject = `How was your visit to ${p.venueName}?`;
  const inner = `
    <p style="margin:0 0 16px;font-size:22px;font-weight:600;">Thanks for dining with us</p>
    <p style="margin:0 0 12px;">Hi ${escapeHtml(p.guestName)},</p>
    <p style="margin:0 0 16px;">We hope you enjoyed your table on <strong>${escapeHtml(p.serviceDate)}</strong> at <strong>${escapeHtml(p.startTime)}</strong>.</p>
    <p style="margin:0 0 24px;text-align:center;">
      <a href="${escapeHtml(p.reviewUrl)}" style="display:inline-block;background:#1a1a1a;color:#fff;text-decoration:none;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:14px;font-weight:600;padding:14px 28px;border-radius:4px;">Leave a review</a>
    </p>
    <p style="margin:0;color:#57534e;font-size:14px;">It only takes a moment — your feedback helps our team.</p>
  `;
  const text = [
    `Thanks for visiting ${p.venueName}`,
    `Hi ${p.guestName},`,
    `We hope you enjoyed your visit on ${p.serviceDate} at ${p.startTime}.`,
    `Leave a review: ${p.reviewUrl}`,
  ].join("\n\n");
  return { subject, html: emailLayout(brandOf(p), inner), text };
}
