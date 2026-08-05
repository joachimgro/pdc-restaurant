"use client";

import { create } from "zustand";
import type {
  DomainEvent,
  FloorPlan,
  Reservation,
  ReservationEvent,
  ReservationStatusAction,
} from "@lead-intake/shared-types";
import { subscribeEvents } from "@/lib/api/client";
import {
  assignReservationTables,
  fetchDay,
  fetchFloorPlan,
  fetchReservation,
  setReservationStatus,
  type ServiceDay,
} from "../api/console";

/**
 * Console state for one service date.
 *
 * The drawer holds an id, never a copy of a reservation — everything renders
 * from `reservations`, so a change arriving over SSE cannot leave a stale copy
 * on screen.
 */

/** Window in which SSE-triggered refetches are batched. */
const COALESCE_MS = 250;
/** Above this many changed reservations, refetch the day instead. */
const REFETCH_ALL_THRESHOLD = 5;

export type ConsoleView = "today" | "floor" | "timeline";

type Toast = { id: string; message: string; kind: "info" | "error" };

export type ServiceConsoleState = {
  status: "idle" | "loading" | "ready" | "error";
  error: string | null;

  serviceDate: string;
  day: ServiceDay | null;
  floorPlan: FloorPlan | null;
  reservations: Record<string, Reservation>;

  view: ConsoleView;
  selectedId: string | null;
  drawerEvents: ReservationEvent[];
  /** Set when a remote change lands on the open reservation while editing. */
  remoteChangeNotice: boolean;

  /** Minutes since midnight the floor is being viewed at (the scrubber). */
  scrubMinutes: number | null;
  nowMinutes: number;

  pending: Record<string, true>;
  toasts: Toast[];

  load: (date?: string) => Promise<void>;
  setView: (view: ConsoleView) => void;
  setDate: (date: string) => Promise<void>;
  select: (id: string | null) => void;
  setScrub: (minutes: number | null) => void;
  tickNow: () => void;
  dismissToast: (id: string) => void;
  acknowledgeRemoteChange: () => void;

  act: (id: string, action: ReservationStatusAction, reason?: string) => Promise<void>;
  reassign: (id: string, tableIds: string[]) => Promise<void>;
  refetchOne: (id: string) => Promise<void>;

  connectEvents: () => () => void;
};

function indexReservations(list: Reservation[]): Record<string, Reservation> {
  const out: Record<string, Reservation> = {};
  for (const r of list) out[r.id] = r;
  return out;
}

function minutesNow(): number {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}

export const useServiceConsole = create<ServiceConsoleState>((set, get) => {
  // Refetch coalescing lives outside the store: it is transport bookkeeping,
  // not state anything renders.
  let pendingIds = new Set<string>();
  let coalesceTimer: number | null = null;

  const flushRefetch = async () => {
    coalesceTimer = null;
    const ids = [...pendingIds];
    pendingIds = new Set();
    if (ids.length === 0) return;

    // A burst — several bookings changed at once — is cheaper and more
    // consistent to resolve with one day fetch than N detail fetches.
    if (ids.length > REFETCH_ALL_THRESHOLD) {
      await get().load(get().serviceDate);
      return;
    }
    await Promise.all(ids.map((id) => get().refetchOne(id)));
  };

  const scheduleRefetch = (id: string) => {
    pendingIds.add(id);
    if (coalesceTimer !== null) return;
    coalesceTimer = window.setTimeout(flushRefetch, COALESCE_MS);
  };

  return {
    status: "idle",
    error: null,

    serviceDate: new Date().toISOString().slice(0, 10),
    day: null,
    floorPlan: null,
    reservations: {},

    view: "today",
    selectedId: null,
    drawerEvents: [],
    remoteChangeNotice: false,

    scrubMinutes: null,
    nowMinutes: minutesNow(),

    pending: {},
    toasts: [],

    load: async (date) => {
      const serviceDate = date ?? get().serviceDate;
      set({ status: get().day ? get().status : "loading", error: null });

      const [dayResult, planResult] = await Promise.all([
        fetchDay(serviceDate),
        get().floorPlan ? Promise.resolve(null) : fetchFloorPlan(),
      ]);

      if (!dayResult.ok) {
        set({ status: "error", error: dayResult.error });
        return;
      }
      if (planResult && !planResult.ok) {
        set({ status: "error", error: planResult.error });
        return;
      }

      set((s) => ({
        status: "ready",
        serviceDate,
        day: dayResult.data,
        floorPlan: planResult?.ok ? planResult.data : s.floorPlan,
        reservations: indexReservations(dayResult.data.reservations),
        nowMinutes: minutesNow(),
      }));
    },

    setView: (view) => set({ view }),

    setDate: async (date) => {
      set({ serviceDate: date, selectedId: null, scrubMinutes: null });
      await get().load(date);
    },

    select: (id) => {
      set({ selectedId: id, drawerEvents: [], remoteChangeNotice: false });
      if (id) void get().refetchOne(id);
    },

    setScrub: (minutes) => set({ scrubMinutes: minutes }),

    tickNow: () => set({ nowMinutes: minutesNow() }),

    dismissToast: (id) =>
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

    acknowledgeRemoteChange: () => set({ remoteChangeNotice: false }),

    refetchOne: async (id) => {
      const result = await fetchReservation(id);
      if (!result.ok) {
        // A 404 means it is genuinely gone; drop it rather than showing a ghost.
        if (result.code === "NOT_FOUND") {
          set((s) => {
            const { [id]: _gone, ...rest } = s.reservations;
            return {
              reservations: rest,
              selectedId: s.selectedId === id ? null : s.selectedId,
            };
          });
        }
        return;
      }
      set((s) => ({
        reservations: { ...s.reservations, [id]: result.data.reservation },
        drawerEvents: s.selectedId === id ? result.data.events : s.drawerEvents,
        remoteChangeNotice:
          s.selectedId === id && s.remoteChangeNotice ? true : s.remoteChangeNotice,
      }));
    },

    /**
     * Optimistic status change with rollback.
     *
     * Seat and finish are pressed while standing at a table; waiting on a round
     * trip before the tile changes colour makes the console feel broken. Create
     * is deliberately never optimistic — a booking that appears then vanishes
     * is worse than a moment's wait.
     */
    act: async (id, action, reason) => {
      const before = get().reservations[id];
      if (!before) return;

      const optimistic = applyActionLocally(before, action);
      set((s) => ({
        reservations: { ...s.reservations, [id]: optimistic },
        pending: { ...s.pending, [id]: true },
      }));

      const result = await setReservationStatus(id, action, reason);

      set((s) => {
        const { [id]: _p, ...pending } = s.pending;
        if (result.ok) {
          return { pending, reservations: { ...s.reservations, [id]: result.data } };
        }
        return {
          pending,
          // Server truth wins: put back exactly what was there before.
          reservations: { ...s.reservations, [id]: before },
          toasts: [
            ...s.toasts,
            { id: crypto.randomUUID(), message: result.error, kind: "error" as const },
          ],
        };
      });
    },

    reassign: async (id, tableIds) => {
      const before = get().reservations[id];
      if (!before) return;

      set((s) => ({
        reservations: {
          ...s.reservations,
          [id]: { ...before, tableIds, assignmentLocked: true },
        },
        pending: { ...s.pending, [id]: true },
      }));

      const result = await assignReservationTables(id, tableIds);

      set((s) => {
        const { [id]: _p, ...pending } = s.pending;
        if (result.ok) {
          return { pending, reservations: { ...s.reservations, [id]: result.data } };
        }
        return {
          pending,
          reservations: { ...s.reservations, [id]: before },
          toasts: [
            ...s.toasts,
            {
              id: crypto.randomUUID(),
              message:
                result.code === "SLOT_TAKEN"
                  ? "That table is already booked for this window."
                  : result.error,
              kind: "error" as const,
            },
          ],
        };
      });
    },

    /**
     * SSE payloads carry ids and changed fields, not whole reservations, so
     * each event triggers a refetch rather than a patch — one request, always
     * correct, and immune to a payload shape drifting.
     */
    connectEvents: () => {
      const unsubscribe = subscribeEvents((event: DomainEvent) => {
        if (!event.type.startsWith("reservation.")) return;

        const payload = event.payload as {
          reservationId?: string;
          serviceDate?: string;
        };
        if (!payload.reservationId) return;
        // Another date's booking is not on screen; ignore it.
        if (payload.serviceDate && payload.serviceDate !== get().serviceDate) {
          return;
        }

        if (payload.reservationId === get().selectedId) {
          set({ remoteChangeNotice: true });
        }
        scheduleRefetch(payload.reservationId);
      });

      return () => {
        if (coalesceTimer !== null) window.clearTimeout(coalesceTimer);
        coalesceTimer = null;
        unsubscribe();
      };
    },
  };
});

/** The local guess for an action, matching the server's transition table. */
function applyActionLocally(
  reservation: Reservation,
  action: ReservationStatusAction
): Reservation {
  const stamp = new Date().toISOString();
  switch (action) {
    case "seat":
      return { ...reservation, status: "seated", seatedAt: stamp };
    case "finish":
      return { ...reservation, status: "finished", finishedAt: stamp };
    case "no_show":
      return { ...reservation, status: "no_show", noShowMarkedAt: stamp };
    case "cancel":
      return { ...reservation, status: "cancelled", cancelledAt: stamp };
    case "reinstate":
      return {
        ...reservation,
        status: "confirmed",
        cancelledAt: null,
        noShowMarkedAt: null,
      };
  }
}

// ── Selectors ───────────────────────────────────────────────────────────────

export function selectReservationList(s: ServiceConsoleState): Reservation[] {
  return Object.values(s.reservations).sort(
    (a, b) =>
      a.startTime.localeCompare(b.startTime) ||
      a.guestName.localeCompare(b.guestName)
  );
}

export function selectSelected(s: ServiceConsoleState): Reservation | null {
  return s.selectedId ? (s.reservations[s.selectedId] ?? null) : null;
}
