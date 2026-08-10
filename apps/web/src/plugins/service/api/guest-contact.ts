import { getApiUrl } from "@/lib/api/client";
import type { ApiResult } from "./console";

export type GuestThread = {
  id: string;
  locationId: string;
  reservationId: string | null;
  guestName: string;
  guestEmail: string | null;
  guestPhone: string | null;
  preview: string | null;
  lastMessageAt: string | null;
  flaggedAt: string | null;
  flagReason: string | null;
  mutedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ContactTimelineItem =
  | {
      kind: "notification";
      id: string;
      at: string;
      channel: string;
      status: string;
      label: string;
      toAddress: string;
      errorText: string | null;
    }
  | {
      kind: "message";
      id: string;
      at: string;
      direction: string;
      channel: string;
      status: string;
      body: string;
      subject: string | null;
      staffUserId: string | null;
    };

export type ReservationContact = {
  thread: GuestThread;
  reservation: {
    id: string;
    guestName: string;
    guestEmail: string | null;
    guestPhone: string | null;
    reference: string;
    serviceDate: string;
    startTime: string;
  };
  timeline: ContactTimelineItem[];
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

export function fetchReservationContact(
  reservationId: string
): Promise<ApiResult<ReservationContact>> {
  return call(`/service/reservations/${reservationId}/contact`);
}

export function sendReservationContact(
  reservationId: string,
  input: { body: string; subject?: string }
): Promise<ApiResult<{ timeline: ContactTimelineItem[]; message: unknown }>> {
  return call(`/service/reservations/${reservationId}/contact`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function fetchGuestThreads(): Promise<
  ApiResult<{ threads: GuestThread[] }>
> {
  return call("/service/guest-threads");
}

export function fetchGuestThread(
  threadId: string
): Promise<ApiResult<ReservationContact & { reservation: ReservationContact["reservation"] | null }>> {
  return call(`/service/guest-threads/${threadId}`);
}

export function flagGuestThread(
  threadId: string,
  reason?: string
): Promise<ApiResult<{ thread: GuestThread }>> {
  return call(`/service/guest-threads/${threadId}/flag`, {
    method: "POST",
    body: JSON.stringify({ reason: reason ?? undefined }),
  });
}

export function muteGuestThread(
  threadId: string
): Promise<ApiResult<{ thread: GuestThread }>> {
  return call(`/service/guest-threads/${threadId}/mute`, {
    method: "POST",
    body: "{}",
  });
}

export function unmuteGuestThread(
  threadId: string
): Promise<ApiResult<{ thread: GuestThread }>> {
  return call(`/service/guest-threads/${threadId}/unmute`, {
    method: "POST",
    body: "{}",
  });
}
