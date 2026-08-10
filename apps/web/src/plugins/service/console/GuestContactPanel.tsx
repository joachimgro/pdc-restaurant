"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchGuestThread,
  fetchReservationContact,
  sendReservationContact,
  type ContactTimelineItem,
} from "../api/guest-contact";
import { useReservationLiveReload } from "../hooks/useReservationLiveReload";

function formatWhen(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function statusLabel(status: string): string {
  switch (status) {
    case "sent":
      return "sent";
    case "failed":
      return "failed";
    case "scheduled":
      return "scheduled";
    case "cancelled":
      return "cancelled";
    case "queued":
      return "queued";
    default:
      return status;
  }
}

type GuestContactPanelProps = {
  reservationId: string | null;
  threadId?: string | null;
  guestEmail?: string | null;
  compact?: boolean;
};

/**
 * Soft Bubble contact timeline + email composer.
 * Used from the reservation drawer and Inbox Guests.
 * Live-reloads over SSE when guest contact / notifications change.
 */
export function GuestContactPanel({
  reservationId,
  threadId = null,
  guestEmail: guestEmailProp = null,
  compact = false,
}: GuestContactPanelProps) {
  const [timeline, setTimeline] = useState<ContactTimelineItem[]>([]);
  const [email, setEmail] = useState<string | null>(guestEmailProp);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [body, setBody] = useState("");
  const [subject, setSubject] = useState("");
  const [sending, setSending] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [resolvedReservationId, setResolvedReservationId] = useState<
    string | null
  >(reservationId);
  const sendingRef = useRef(false);

  const load = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (sendingRef.current) return;
      if (!opts?.silent) {
        setLoading(true);
        setError(null);
      }
      if (reservationId) {
        const result = await fetchReservationContact(reservationId);
        if (!opts?.silent) setLoading(false);
        if (!result.ok) {
          if (!opts?.silent) setError(result.error);
          return;
        }
        setTimeline(result.data.timeline);
        setEmail(result.data.reservation.guestEmail);
        setResolvedReservationId(result.data.reservation.id);
        setError(null);
        return;
      }
      if (threadId) {
        const result = await fetchGuestThread(threadId);
        if (!opts?.silent) setLoading(false);
        if (!result.ok) {
          if (!opts?.silent) setError(result.error);
          return;
        }
        setTimeline(result.data.timeline);
        setEmail(
          result.data.thread.guestEmail ??
            result.data.reservation?.guestEmail ??
            null
        );
        setResolvedReservationId(result.data.reservation?.id ?? null);
        setError(null);
        return;
      }
      if (!opts?.silent) {
        setLoading(false);
        setError("No contact thread");
      }
    },
    [reservationId, threadId]
  );

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (guestEmailProp) setEmail(guestEmailProp);
  }, [guestEmailProp]);

  useReservationLiveReload(
    {
      reservationIds: [reservationId, resolvedReservationId],
      guestContactOnly: true,
      enabled: Boolean(reservationId || threadId),
    },
    () => {
      void load({ silent: true });
    }
  );

  const canSend = Boolean(email?.trim()) && Boolean(resolvedReservationId);

  const send = async () => {
    if (!resolvedReservationId || !body.trim() || sending) return;
    setSending(true);
    sendingRef.current = true;
    setToast(null);
    const result = await sendReservationContact(resolvedReservationId, {
      body: body.trim(),
      subject: subject.trim() || undefined,
    });
    setSending(false);
    sendingRef.current = false;
    if (!result.ok) {
      setToast(result.error);
      // Still refresh — failed sends are recorded in the timeline.
      if (result.details && typeof result.details === "object") {
        void load({ silent: true });
      }
      return;
    }
    setBody("");
    setSubject("");
    setTimeline(result.data.timeline);
    setToast("Email sent");
    setTimeout(() => setToast(null), 2500);
  };

  return (
    <section
      className={`gc-panel${compact ? " gc-panel-compact" : ""}`}
      aria-label="Guest contact"
    >
      <h3 className="gc-title">Contact</h3>

      {loading && <p className="gc-muted">Loading history…</p>}
      {error && !loading && <p className="gc-error">{error}</p>}

      {!loading && !error && (
        <ol className="gc-timeline">
          {timeline.length === 0 && (
            <li className="gc-muted">No messages yet.</li>
          )}
          {timeline.map((item) =>
            item.kind === "notification" ? (
              <li key={`n-${item.id}`} className="gc-item gc-item-system">
                <div className="msg-bubble message-ai gc-bubble">
                  <span className="gc-label">{item.label}</span>
                  <span className={`gc-status gc-status-${item.status}`}>
                    {statusLabel(item.status)}
                  </span>
                </div>
                <div className="msg-meta">
                  <span>{formatWhen(item.at)}</span>
                  <span>{item.channel}</span>
                </div>
                {item.errorText && (
                  <p className="gc-error-detail">{item.errorText}</p>
                )}
              </li>
            ) : (
              <li
                key={`m-${item.id}`}
                className={`gc-item ${
                  item.direction === "inbound"
                    ? "gc-item-guest"
                    : "gc-item-staff"
                }`}
              >
                <div
                  className={`msg-bubble gc-bubble ${
                    item.direction === "inbound"
                      ? "message-lead"
                      : "message-staff"
                  }`}
                >
                  {item.subject && (
                    <div className="gc-subject">{item.subject}</div>
                  )}
                  <div className="gc-body">{item.body}</div>
                </div>
                <div className="msg-meta">
                  <span className="msg-tag">
                    {item.direction === "inbound" ? "Guest" : "Staff"}
                  </span>
                  <span>{formatWhen(item.at)}</span>
                  <span className={`gc-status gc-status-${item.status}`}>
                    {statusLabel(item.status)}
                  </span>
                </div>
              </li>
            )
          )}
        </ol>
      )}

      <div className="gc-composer">
        {!canSend && (
          <p className="gc-hint">
            Add an email on the booking to send a message.
          </p>
        )}
        <label className="gc-field-label" htmlFor="gc-subject">
          Subject <span className="gc-optional">(optional)</span>
        </label>
        <input
          id="gc-subject"
          className="gc-input"
          type="text"
          value={subject}
          disabled={!canSend || sending}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="Re: your booking"
        />
        <label className="gc-field-label" htmlFor="gc-body">
          Message
        </label>
        <textarea
          id="gc-body"
          className="gc-textarea"
          rows={compact ? 3 : 4}
          value={body}
          disabled={!canSend || sending}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Write to the guest…"
        />
        <div className="gc-composer-actions">
          <button
            type="button"
            className="sc-action sc-action-primary"
            disabled={!canSend || !body.trim() || sending}
            onClick={() => void send()}
          >
            {sending ? "Sending…" : "Send email"}
          </button>
          {toast && (
            <span
              className={
                toast === "Email sent" ? "gc-toast-ok" : "gc-toast-err"
              }
              role="status"
            >
              {toast}
            </span>
          )}
        </div>
      </div>
    </section>
  );
}
