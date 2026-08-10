import { getApiUrl } from "@/lib/api/client";
import type { ApiResult } from "./console";

export type WaitlistEntry = {
  id: string;
  locationId: string;
  guestName: string;
  guestPhone: string | null;
  guestEmail: string | null;
  partySize: number;
  kind: "walk_in" | "date_waitlist";
  serviceDate: string;
  requestedFrom: string | null;
  requestedTo: string | null;
  status: string;
  position?: number;
  joinedAt: string;
  notifiedAt: string | null;
  notifyExpiresAt: string | null;
  notifyCount: number;
  reservationId: string | null;
  notes: string | null;
};

async function call<T>(
  path: string,
  init?: RequestInit
): Promise<ApiResult<T>> {
  let res: Response;
  try {
    res = await fetch(`${getApiUrl()}${path}`, {
      cache: "no-store",
      credentials: "include",
      ...init,
      headers: { "Content-Type": "application/json", ...init?.headers },
    });
  } catch {
    return {
      ok: false,
      code: "NETWORK",
      error: "Could not reach the server.",
    };
  }

  const body = (await res.json().catch(() => null)) as
    | (Record<string, unknown> & { error?: string; code?: string })
    | null;

  if (!res.ok) {
    return {
      ok: false,
      code: body?.code ?? `HTTP_${res.status}`,
      error: body?.error ?? `Request failed (${res.status})`,
      details: body?.details,
    };
  }
  return { ok: true, data: body as T };
}

export function fetchWaitlist(
  date: string,
  locationId?: string
): Promise<ApiResult<{ entries: WaitlistEntry[]; serviceDate: string }>> {
  const q = new URLSearchParams({ date });
  if (locationId) q.set("locationId", locationId);
  return call(`/service/waitlist?${q}`);
}

export function createWaitlistEntry(input: {
  guestName: string;
  partySize: number;
  kind?: "walk_in" | "date_waitlist";
  serviceDate: string;
  guestPhone?: string;
  guestEmail?: string;
  notes?: string;
}): Promise<ApiResult<{ entry: WaitlistEntry }>> {
  return call("/service/waitlist", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function notifyWaitlistEntry(
  id: string
): Promise<ApiResult<{ entry: WaitlistEntry }>> {
  return call(`/service/waitlist/${id}/notify`, { method: "POST", body: "{}" });
}

export function convertWaitlistEntry(
  id: string,
  reservationId?: string
): Promise<ApiResult<{ entry: WaitlistEntry; reservation: unknown }>> {
  return call(`/service/waitlist/${id}/convert`, {
    method: "POST",
    body: JSON.stringify(reservationId ? { reservationId } : {}),
  });
}

export function removeWaitlistEntry(
  id: string,
  reason?: string
): Promise<ApiResult<{ entry: WaitlistEntry }>> {
  return call(`/service/waitlist/${id}/remove`, {
    method: "POST",
    body: JSON.stringify({ reason: reason ?? "" }),
  });
}
