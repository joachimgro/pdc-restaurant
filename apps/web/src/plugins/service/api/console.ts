import {
  FloorPlanSchema,
  type FloorPlan,
  type PacingRule,
  type Reservation,
  type ReservationEvent,
  type ReservationStatusAction,
  type ServicePeriod,
  type TurnTimeRule,
  type VenueSettings,
} from "@lead-intake/shared-types";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787";

export type ServiceDay = {
  serviceDate: string;
  settings: VenueSettings;
  periods: ServicePeriod[];
  venueTurnRules: TurnTimeRule[];
  venuePacingRules: PacingRule[];
  reservations: Reservation[];
};

export type ApiFailure = {
  ok: false;
  code: string;
  error: string;
  details?: unknown;
};

export type ApiResult<T> = { ok: true; data: T } | ApiFailure;

/**
 * Every mutation returns a discriminated result rather than throwing, because
 * the console's optimistic actions need the failure *code* to decide between
 * rolling back quietly and explaining a conflict.
 */
async function call<T>(
  path: string,
  init?: RequestInit
): Promise<ApiResult<T>> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      cache: "no-store",
      credentials: "include",
      ...init,
      headers: { "Content-Type": "application/json", ...init?.headers },
    });
  } catch {
    return {
      ok: false,
      code: "NETWORK",
      error: "Could not reach the server. Nothing was changed.",
    };
  }

  if (res.status === 204) return { ok: true, data: undefined as T };

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

export function fetchDay(date: string): Promise<ApiResult<ServiceDay>> {
  return call<ServiceDay>(`/service/day?date=${encodeURIComponent(date)}`);
}

export async function fetchFloorPlan(): Promise<ApiResult<FloorPlan>> {
  const result = await call<unknown>("/service/floor-plan");
  if (!result.ok) return result;
  return { ok: true, data: FloorPlanSchema.parse(result.data) };
}

export function fetchReservation(
  id: string
): Promise<ApiResult<{ reservation: Reservation; events: ReservationEvent[] }>> {
  return call(`/service/reservations/${id}`);
}

export type AvailabilitySlotDto = {
  time: string;
  periodId: string;
  available: boolean;
  endTime: string;
  turnMinutes: number;
  assignment: { tableIds: string[]; seatsTotal: number } | null;
  remainingCovers: number | null;
  reason?: string;
};

/**
 * Staff channel: unavailable slots come back with their reason so the console
 * can grey them out and say why, rather than silently hiding a time a manager
 * is asking about.
 */
export function fetchAvailability(
  date: string,
  partySize: number
): Promise<ApiResult<{ slots: AvailabilitySlotDto[]; largePartyMessage: string | null }>> {
  return call(
    `/service/availability?date=${encodeURIComponent(date)}&partySize=${partySize}&channel=staff`
  );
}

export function createReservation(
  input: Record<string, unknown>
): Promise<ApiResult<Reservation>> {
  return call("/service/reservations", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function patchReservation(
  id: string,
  patch: Record<string, unknown>
): Promise<ApiResult<{ reservation: Reservation; warning: string | null }>> {
  return call(`/service/reservations/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export function setReservationStatus(
  id: string,
  action: ReservationStatusAction,
  reason?: string
): Promise<ApiResult<Reservation>> {
  return call(`/service/reservations/${id}/status`, {
    method: "POST",
    body: JSON.stringify({ action, reason: reason ?? null }),
  });
}

export function assignReservationTables(
  id: string,
  tableIds: string[]
): Promise<ApiResult<Reservation>> {
  return call(`/service/reservations/${id}/tables`, {
    method: "PUT",
    body: JSON.stringify({ tableIds }),
  });
}
