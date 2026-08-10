"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  fetchGuestThread,
  flagGuestThread,
  muteGuestThread,
  unmuteGuestThread,
  type GuestThread,
} from "@/plugins/service/api/guest-contact";
import { GuestContactPanel } from "@/plugins/service/console/GuestContactPanel";
import { useReservationLiveReload } from "@/plugins/service/hooks/useReservationLiveReload";
import "@/plugins/service/console/console.css";

export function GuestConversationPanel({
  threadId,
}: {
  threadId: string | null;
}) {
  const [thread, setThread] = useState<GuestThread | null>(null);
  const [reservation, setReservation] = useState<{
    id: string;
    reference: string;
    serviceDate: string;
    startTime: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [moderating, setModerating] = useState(false);

  const load = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!threadId) {
        setThread(null);
        setReservation(null);
        return;
      }
      const result = await fetchGuestThread(threadId);
      if (!result.ok) {
        if (!opts?.silent) {
          setError(result.error);
          setThread(null);
          setReservation(null);
        }
        return;
      }
      setError(null);
      setThread(result.data.thread);
      setReservation(
        result.data.reservation
          ? {
              id: result.data.reservation.id,
              reference: result.data.reservation.reference,
              serviceDate: result.data.reservation.serviceDate,
              startTime: result.data.reservation.startTime,
            }
          : null
      );
    },
    [threadId]
  );

  useEffect(() => {
    void load();
  }, [load]);

  useReservationLiveReload(
    {
      reservationIds: [reservation?.id],
      guestContactOnly: true,
      enabled: Boolean(threadId && reservation?.id),
    },
    () => {
      void load({ silent: true });
    }
  );

  async function moderate(
    action: () => Promise<{ ok: boolean; error?: string }>
  ) {
    if (!threadId) return;
    setModerating(true);
    const result = await action();
    setModerating(false);
    if (!result.ok) {
      setError(result.error ?? "Action failed");
      return;
    }
    await load({ silent: true });
  }

  if (!threadId) {
    return (
      <main className="conversation">
        <div className="conv-empty">Select a guest</div>
      </main>
    );
  }

  if (error) {
    return (
      <main className="conversation">
        <div className="conv-empty">{error}</div>
      </main>
    );
  }

  if (!thread) {
    return (
      <main className="conversation">
        <div className="conv-empty">Loading…</div>
      </main>
    );
  }

  return (
    <main className="conversation guest-conversation">
      <div className="conv-header">
        <div className="conv-header-left">
          <div className="conv-header-info">
            <div className="conv-name">{thread.guestName}</div>
            <div className="conv-sub">
              {thread.guestEmail && <span>{thread.guestEmail}</span>}
              {thread.guestEmail && thread.guestPhone && (
                <span className="conv-sub-dot" />
              )}
              {thread.guestPhone && <span>{thread.guestPhone}</span>}
            </div>
          </div>
        </div>
        {reservation && (
          <div className="conv-header-actions">
            <Link
              className="btn-view-profile"
              href={`/inbox?view=service&date=${encodeURIComponent(reservation.serviceDate)}&reservation=${encodeURIComponent(reservation.id)}`}
            >
              Open booking {reservation.reference}
            </Link>
          </div>
        )}
      </div>

      <div className="guests-moderation-actions" style={{ padding: "0 16px 8px" }}>
        {thread.flaggedAt ? (
          <span className="guests-flag-badge">Flagged{thread.flagReason ? `: ${thread.flagReason}` : ""}</span>
        ) : (
          <button
            type="button"
            className="sc-action"
            disabled={moderating}
            onClick={() =>
              void moderate(() => flagGuestThread(thread.id, "Needs review"))
            }
          >
            Flag
          </button>
        )}
        {thread.mutedAt ? (
          <button
            type="button"
            className="sc-action"
            disabled={moderating}
            onClick={() => void moderate(() => unmuteGuestThread(thread.id))}
          >
            Unmute
          </button>
        ) : (
          <button
            type="button"
            className="sc-action"
            disabled={moderating}
            onClick={() => void moderate(() => muteGuestThread(thread.id))}
          >
            Mute
          </button>
        )}
      </div>

      <div className="guest-conversation-body messages">
        <GuestContactPanel
          reservationId={reservation?.id ?? null}
          threadId={thread.id}
          guestEmail={thread.guestEmail}
        />
      </div>
    </main>
  );
}
