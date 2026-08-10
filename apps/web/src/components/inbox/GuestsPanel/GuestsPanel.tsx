"use client";

import { useCallback, useEffect, useState } from "react";
import {
  fetchGuestThreads,
  type GuestThread,
} from "@/plugins/service/api/guest-contact";
import { useReservationLiveReload } from "@/plugins/service/hooks/useReservationLiveReload";

function formatWhen(iso: string | null): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

export function GuestsPanel({
  activeThreadId,
  onSelect,
}: {
  activeThreadId: string | null;
  onSelect: (threadId: string) => void;
}) {
  const [threads, setThreads] = useState<GuestThread[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) {
      setLoading(true);
      setError(null);
    }
    const result = await fetchGuestThreads();
    if (!opts?.silent) setLoading(false);
    if (!result.ok) {
      if (!opts?.silent) setError(result.error);
      return;
    }
    setThreads(result.data.threads);
    setError(null);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useReservationLiveReload(
    {
      onAnyCreated: true,
      guestContactOnly: true,
    },
    () => {
      void load({ silent: true });
    }
  );

  return (
    <aside className="leads guests-panel">
      <div className="leads-header">
        <div>
          <div className="leads-title">Guests</div>
          <div className="leads-count">
            {loading
              ? "…"
              : `${threads.length} thread${threads.length === 1 ? "" : "s"}`}
          </div>
        </div>
      </div>

      <div className="leads-scroll">
        {loading && <div className="leads-empty-filter">Loading…</div>}
        {error && !loading && (
          <div className="leads-empty-filter">{error}</div>
        )}
        {!loading && !error && threads.length === 0 && (
          <div className="leads-empty-filter">
            No guest threads yet. Bookings with email will appear here.
          </div>
        )}
        {!loading &&
          !error &&
          threads.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`lead-row guests-row${activeThreadId === t.id ? " active" : ""}`}
              onClick={() => onSelect(t.id)}
            >
              <div className="lead-row-main">
                <div className="lead-name">
                  {t.guestName}
                  {t.flaggedAt ? (
                    <span className="guests-flag-badge">Flagged</span>
                  ) : null}
                </div>
                <div className="lead-preview">
                  {t.preview ?? t.guestEmail ?? t.guestPhone ?? "—"}
                </div>
              </div>
              <div className="lead-row-meta">
                <span className="lead-time">{formatWhen(t.lastMessageAt)}</span>
              </div>
            </button>
          ))}
      </div>
    </aside>
  );
}
