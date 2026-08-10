import { getApiUrl } from "@/lib/api/client";

async function bookFetch<T>(
  path: string,
  init?: RequestInit & { idempotencyKey?: string }
): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set("Content-Type", "application/json");
  if (init?.idempotencyKey) {
    headers.set("Idempotency-Key", init.idempotencyKey);
  }
  const res = await fetch(`${getApiUrl()}${path}`, {
    ...init,
    headers,
  });
  const data = (await res.json().catch(() => ({}))) as T & {
    error?: string;
    code?: string;
  };
  if (!res.ok) {
    const err = new Error(data.error ?? `Request failed (${res.status})`) as Error & {
      code?: string;
      details?: unknown;
      status: number;
    };
    err.code = data.code;
    err.details = (data as { details?: unknown }).details;
    err.status = res.status;
    throw err;
  }
  return data as T;
}

export type BookVenue = {
  slug: string | null;
  name: string;
  timezone: string;
  minParty: number;
  maxParty: number;
  largePartyMessage: string | null;
  contactPhone: string | null;
  addressText: string | null;
  brand: Record<string, unknown> | null;
  holdTtlSeconds: number;
  waitlistEnabled?: boolean;
  bookingSmsEnabled?: boolean;
  maxAdvanceDays?: number;
};

export function getBookVenue(slug: string) {
  return bookFetch<BookVenue>(`/book/${encodeURIComponent(slug)}/venue`);
}

export function getBookDays(
  slug: string,
  opts: { party: number; from: string; to: string }
) {
  const q = new URLSearchParams({
    party: String(opts.party),
    from: opts.from,
    to: opts.to,
  });
  return bookFetch<{
    days: Array<{ date: string; available: boolean; slotCount: number }>;
  }>(`/book/${encodeURIComponent(slug)}/days?${q}`);
}

export function getBookAvailability(
  slug: string,
  opts: { date: string; party: number }
) {
  const q = new URLSearchParams({
    date: opts.date,
    party: String(opts.party),
  });
  return bookFetch<{
    slots: Array<{ time: string; endTime: string }>;
    softExit: string | null;
    contactPhone: string | null;
    largePartyMessage: string | null;
  }>(`/book/${encodeURIComponent(slug)}/availability?${q}`);
}

export function postBookHold(
  slug: string,
  body: {
    partySize: number;
    serviceDate: string;
    startTime: string;
    turnstileToken?: string;
  }
) {
  return bookFetch<{
    holdToken: string;
    expiresAt: string | null;
    serviceDate: string;
    startTime: string;
    endTime: string;
    partySize: number;
  }>(`/book/${encodeURIComponent(slug)}/hold`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function postBookReserve(
  slug: string,
  body: Record<string, unknown>,
  idempotencyKey: string
) {
  return bookFetch<{
    reservation: {
      reference: string;
      serviceDate: string;
      startTime: string;
      partySize: number;
      guestName: string;
      status?: string;
    };
    manageToken: string | null;
    manageUrl: string | null;
    checkoutUrl?: string | null;
  }>(`/book/${encodeURIComponent(slug)}/reserve`, {
    method: "POST",
    body: JSON.stringify(body),
    idempotencyKey,
  });
}

export function getManageBooking(token: string) {
  return bookFetch<{
    reservation: {
      reference: string;
      guestName: string;
      partySize: number;
      serviceDate: string;
      startTime: string;
      endTime: string;
      status: string;
    };
    venue: {
      name: string;
      addressText: string | null;
      contactPhone: string | null;
    } | null;
    actions: { canCancel: boolean; canModify: boolean };
  }>(`/book/manage/${encodeURIComponent(token)}`);
}

export function postManageCancel(token: string, reason?: string) {
  return bookFetch(`/book/manage/${encodeURIComponent(token)}/cancel`, {
    method: "POST",
    body: JSON.stringify({ reason: reason ?? null }),
  });
}

export function postBookWaitlist(
  slug: string,
  body: {
    guestName: string;
    partySize: number;
    serviceDate: string;
    guestEmail?: string;
    guestPhone?: string;
    kind?: "date_waitlist" | "walk_in";
    requestedFrom?: string;
    requestedTo?: string;
    turnstileToken?: string;
  }
) {
  return bookFetch<{
    entry: { id: string; position?: number };
    message: string;
  }>(`/book/${encodeURIComponent(slug)}/waitlist`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}
