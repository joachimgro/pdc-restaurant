"use client";

import { useCallback, useEffect, useState } from "react";
import {
  convertWaitlistEntry,
  createWaitlistEntry,
  fetchWaitlist,
  notifyWaitlistEntry,
  removeWaitlistEntry,
  type WaitlistEntry,
} from "../api/waitlist";
import { useServiceConsole } from "../store/service-console-store";

function waitMinutes(iso: string, now: number): number {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Math.floor((now - t) / 60_000));
}

export function WaitlistPanel() {
  const serviceDate = useServiceConsole((s) => s.serviceDate);
  const loadDay = useServiceConsole((s) => s.load);
  const [entries, setEntries] = useState<WaitlistEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [guestName, setGuestName] = useState("");
  const [partySize, setPartySize] = useState(2);
  const [guestPhone, setGuestPhone] = useState("");
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await fetchWaitlist(serviceDate);
    setLoading(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setEntries(result.data.entries);
  }, [serviceDate]);

  useEffect(() => {
    void load();
  }, [load]);

  // Busy service: keep the queue fresh without staff tapping refresh.
  useEffect(() => {
    const poll = window.setInterval(() => void load(), 20_000);
    const tick = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      window.clearInterval(poll);
      window.clearInterval(tick);
    };
  }, [load]);

  async function runAction(
    id: string,
    action: () => Promise<{ ok: boolean; error?: string }>,
    opts?: { refreshDay?: boolean }
  ) {
    setPending(id);
    setError(null);
    const result = await action();
    setPending(null);
    if (!result.ok) {
      setError(result.error ?? "Action failed");
      return;
    }
    await load();
    if (opts?.refreshDay) void loadDay(serviceDate);
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!guestName.trim()) return;
    setPending("add");
    setError(null);
    const result = await createWaitlistEntry({
      guestName: guestName.trim(),
      partySize,
      kind: "walk_in",
      serviceDate,
      guestPhone: guestPhone.trim() || undefined,
    });
    setPending(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setGuestName("");
    setGuestPhone("");
    setPartySize(2);
    setShowAdd(false);
    await load();
  }

  const active = entries.filter(
    (e) => e.status === "waiting" || e.status === "notified"
  );

  return (
    <div className="sc-waitlist">
      <div className="sc-waitlist-header">
        <div>
          <h2 className="sc-waitlist-title">Waitlist</h2>
          <p className="sc-waitlist-sub">
            {loading ? "…" : `${active.length} waiting`}
            {!loading && active.length > 0
              ? ` · oldest ${Math.max(...active.map((e) => waitMinutes(e.joinedAt, now)))}m`
              : ""}
          </p>
        </div>
        <button
          type="button"
          className="sc-action sc-action-primary"
          onClick={() => setShowAdd((v) => !v)}
        >
          {showAdd ? "Cancel" : "Add walk-in"}
        </button>
      </div>

      {error ? (
        <p className="sc-waitlist-error" role="alert">
          {error}
          <button type="button" className="sc-action" onClick={() => setError(null)}>
            Dismiss
          </button>
        </p>
      ) : null}

      {showAdd && (
        <form className="sc-waitlist-add" onSubmit={(e) => void handleAdd(e)}>
          <label className="sc-field">
            <span>Name</span>
            <input
              className="sc-input"
              value={guestName}
              onChange={(e) => setGuestName(e.target.value)}
              autoComplete="name"
              autoFocus
              required
            />
          </label>
          <label className="sc-field">
            <span>Party</span>
            <input
              className="sc-input"
              type="number"
              min={1}
              max={20}
              value={partySize}
              onChange={(e) => setPartySize(Number(e.target.value))}
            />
          </label>
          <label className="sc-field">
            <span>Phone (optional)</span>
            <input
              className="sc-input"
              type="tel"
              value={guestPhone}
              onChange={(e) => setGuestPhone(e.target.value)}
              autoComplete="tel"
            />
          </label>
          <button
            type="submit"
            className="sc-action sc-action-primary"
            disabled={pending === "add" || !guestName.trim()}
          >
            {pending === "add" ? "Adding…" : "Join queue"}
          </button>
        </form>
      )}

      <div className="sc-waitlist-list">
        {loading && <p className="sc-empty">Loading waitlist…</p>}
        {!loading && active.length === 0 && (
          <p className="sc-empty">
            Queue empty. Add a walk-in, or share the public join link.
          </p>
        )}
        {!loading &&
          active.map((entry) => (
            <WaitlistCard
              key={entry.id}
              entry={entry}
              waited={waitMinutes(entry.joinedAt, now)}
              busy={pending === entry.id}
              onNotify={() =>
                void runAction(entry.id, () => notifyWaitlistEntry(entry.id))
              }
              onSeat={() =>
                void runAction(
                  entry.id,
                  () => convertWaitlistEntry(entry.id),
                  { refreshDay: true }
                )
              }
              onRemove={() => {
                if (
                  !window.confirm(
                    `Remove ${entry.guestName} from the waitlist?`
                  )
                ) {
                  return;
                }
                void runAction(entry.id, () =>
                  removeWaitlistEntry(entry.id, "Removed by staff")
                );
              }}
            />
          ))}
      </div>
    </div>
  );
}

function WaitlistCard({
  entry,
  waited,
  busy,
  onNotify,
  onSeat,
  onRemove,
}: {
  entry: WaitlistEntry;
  waited: number;
  busy: boolean;
  onNotify: () => void;
  onSeat: () => void;
  onRemove: () => void;
}) {
  return (
    <article
      className={`sc-waitlist-card${entry.status === "notified" ? " is-notified" : ""}${waited >= 30 ? " is-long-wait" : ""}`}
    >
      <div className="sc-waitlist-card-main">
        <span className="sc-waitlist-pos">#{entry.position ?? "—"}</span>
        <div>
          <div className="sc-waitlist-name">{entry.guestName}</div>
          <div className="sc-waitlist-meta">
            Party of {entry.partySize}
            {entry.guestPhone ? ` · ${entry.guestPhone}` : ""}
            {" · "}
            <span className="fp-num">{waited}m</span>
            {entry.status === "notified" ? " · table ready" : ""}
          </div>
        </div>
      </div>
      <div className="sc-waitlist-actions">
        <button
          type="button"
          className="sc-waitlist-btn sc-waitlist-btn-notify"
          disabled={busy || entry.status === "notified"}
          onClick={onNotify}
        >
          {entry.status === "notified" ? "Notified" : "Notify"}
        </button>
        <button
          type="button"
          className="sc-waitlist-btn sc-waitlist-btn-seat"
          disabled={busy}
          onClick={onSeat}
        >
          Seat
        </button>
        <button
          type="button"
          className="sc-waitlist-btn sc-waitlist-btn-remove"
          disabled={busy}
          onClick={onRemove}
        >
          Remove
        </button>
      </div>
    </article>
  );
}
