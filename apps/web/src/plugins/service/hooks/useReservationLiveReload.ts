import type { DomainEvent } from "@lead-intake/shared-types";
import { useEffect, useRef } from "react";
import { subscribeEvents } from "@/lib/api/client";

function reservationIdOf(event: DomainEvent): string | null {
  if (!event.type.startsWith("reservation.")) return null;
  const id = (event.payload as { reservationId?: string }).reservationId;
  return id ?? null;
}

function isGuestContactEvent(event: DomainEvent): boolean {
  if (event.type !== "reservation.updated") return false;
  const patch = (event.payload as { patch?: Record<string, unknown> }).patch;
  return Boolean(patch && patch.guestContact);
}

export type ReservationLiveReloadOpts = {
  /** When set, only events for these reservation ids reload (unless onAnyCreated). */
  reservationIds?: Array<string | null | undefined>;
  /** Reload on reservation.created (any booking). */
  onAnyCreated?: boolean;
  /**
   * Only guestContact patches (and created if onAnyCreated).
   * When true with empty reservationIds, any guestContact event reloads
   * (Inbox Guests list).
   */
  guestContactOnly?: boolean;
  enabled?: boolean;
  debounceMs?: number;
};

/**
 * Reload guest contact / guests list when reservation SSE events land.
 * Debounced so a burst of schedule+dispatch events becomes one fetch.
 */
export function useReservationLiveReload(
  opts: ReservationLiveReloadOpts,
  reload: () => void
): void {
  const reloadRef = useRef(reload);
  reloadRef.current = reload;

  const idsKey = (opts.reservationIds ?? [])
    .filter(Boolean)
    .join("|");

  useEffect(() => {
    if (opts.enabled === false) return;

    const watch = new Set(
      (opts.reservationIds ?? []).filter((id): id is string => Boolean(id))
    );
    let timer: number | null = null;

    const schedule = () => {
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        timer = null;
        reloadRef.current();
      }, opts.debounceMs ?? 250);
    };

    const unsubscribe = subscribeEvents((event) => {
      if (opts.onAnyCreated && event.type === "reservation.created") {
        schedule();
        return;
      }

      if (opts.guestContactOnly) {
        if (!isGuestContactEvent(event)) return;
        const rid = reservationIdOf(event);
        if (!rid) return;
        // Empty watch → any guest contact (list). Otherwise match id.
        if (watch.size === 0 || watch.has(rid)) schedule();
        return;
      }

      const rid = reservationIdOf(event);
      if (!rid) return;
      if (watch.size > 0 && !watch.has(rid)) return;
      schedule();
    });

    return () => {
      if (timer !== null) window.clearTimeout(timer);
      unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    idsKey,
    opts.enabled,
    opts.onAnyCreated,
    opts.guestContactOnly,
    opts.debounceMs,
  ]);
}
