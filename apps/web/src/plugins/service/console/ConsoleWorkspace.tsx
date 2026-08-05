"use client";

import { useEffect, useMemo, useState } from "react";
import { HeaderStrip } from "./HeaderStrip";
import { NewBookingPanel } from "./NewBookingPanel";
import { PacingRibbon } from "./PacingRibbon";
import { ReservationDrawer } from "./ReservationDrawer";
import { ReservationList } from "./ReservationList";
import { ServiceCanvas } from "./ServiceCanvas";
import { TimelineView } from "./TimelineView";
import { formatHHMM, parseHHMM } from "./status";
import {
  useServiceConsole,
  type ConsoleView,
} from "../store/service-console-store";
import "./console.css";

/** How often the live clock advances. Statuses turn over on the minute. */
const TICK_MS = 30_000;

const VIEWS: { id: ConsoleView; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "floor", label: "Floor" },
  { id: "timeline", label: "Timeline" },
];

export function ConsoleWorkspace() {
  const status = useServiceConsole((s) => s.status);
  const error = useServiceConsole((s) => s.error);
  const view = useServiceConsole((s) => s.view);
  const setView = useServiceConsole((s) => s.setView);
  const load = useServiceConsole((s) => s.load);
  const tickNow = useServiceConsole((s) => s.tickNow);
  const connectEvents = useServiceConsole((s) => s.connectEvents);
  const toasts = useServiceConsole((s) => s.toasts);
  const dismissToast = useServiceConsole((s) => s.dismissToast);
  const selectedId = useServiceConsole((s) => s.selectedId);

  const [booking, setBooking] = useState(false);

  useEffect(() => {
    if (useServiceConsole.getState().status === "idle") void load();
  }, [load]);

  useEffect(() => {
    const timer = window.setInterval(tickNow, TICK_MS);
    return () => window.clearInterval(timer);
  }, [tickNow]);

  // One stream for the console's lifetime. The inbox keeps its own; see the
  // double-EventSource note in spec §20.
  useEffect(() => connectEvents(), [connectEvents]);

  if (status === "loading" || status === "idle") {
    return <div className="sc-loading">Loading service</div>;
  }
  if (status === "error") {
    return (
      <div className="sc-loading sc-loading-error">
        <p>{error}</p>
        <button type="button" className="sc-action" onClick={() => void load()}>
          Try again
        </button>
      </div>
    );
  }

  return (
    <div className={`sc-root sc-view-${view}${selectedId ? " has-selection" : ""}`}>
      <HeaderStrip />

      <nav className="sc-tabs" role="tablist" aria-label="Service views">
        {VIEWS.map((v) => (
          <button
            key={v.id}
            type="button"
            role="tab"
            aria-selected={view === v.id}
            className={`sc-tab${view === v.id ? " is-active" : ""}`}
            onClick={() => setView(v.id)}
          >
            {v.label}
          </button>
        ))}
        <button
          type="button"
          className="sc-action sc-action-primary sc-new-booking"
          onClick={() => setBooking(true)}
        >
          New booking
        </button>
      </nav>

      <PacingRibbon />

      <div className="sc-body">
        <main className="sc-main">
          {view === "today" && <ReservationList />}
          {view === "floor" && <FloorPane />}
          {view === "timeline" && <TimelineView />}
        </main>

        <ReservationDrawer />
      </div>

      {booking && (
        <div className="sc-modal" role="dialog" aria-modal="true">
          <div
            className="sc-modal-scrim"
            onClick={() => setBooking(false)}
            aria-hidden="true"
          />
          <div className="sc-modal-panel">
            <NewBookingPanel onClose={() => setBooking(false)} />
          </div>
        </div>
      )}

      <div className="sc-toasts" aria-live="assertive">
        {toasts.map((t) => (
          <div key={t.id} className={`sc-toast sc-toast-${t.kind}`} role="alert">
            <span>{t.message}</span>
            <button
              type="button"
              className="sc-icon-btn"
              aria-label="Dismiss"
              onClick={() => dismissToast(t.id)}
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Floor plan with room tabs and the time scrubber below it. */
function FloorPane() {
  const floorPlan = useServiceConsole((s) => s.floorPlan);
  const day = useServiceConsole((s) => s.day);
  const nowMinutes = useServiceConsole((s) => s.nowMinutes);
  const scrubMinutes = useServiceConsole((s) => s.scrubMinutes);
  const setScrub = useServiceConsole((s) => s.setScrub);
  const [roomId, setRoomId] = useState<string | null>(null);

  const rooms = useMemo(
    () => (floorPlan?.rooms ?? []).filter((r) => r.isActive),
    [floorPlan]
  );

  const activeRoom = rooms.find((r) => r.id === roomId) ?? rooms[0];

  const bounds = useMemo(() => {
    if (!day || day.periods.length === 0) return { from: 17 * 60, to: 23 * 60 };
    return {
      from: Math.min(...day.periods.map((p) => parseHHMM(p.startTime))),
      to: Math.max(...day.periods.map((p) => parseHHMM(p.endTime))),
    };
  }, [day]);

  if (!activeRoom) {
    return <p className="sc-empty">No rooms in the floor plan yet.</p>;
  }

  const at = scrubMinutes ?? nowMinutes;

  return (
    <div className="sc-floor">
      {rooms.length > 1 && (
        <div className="sc-room-tabs" role="tablist" aria-label="Rooms">
          {rooms.map((r) => (
            <button
              key={r.id}
              type="button"
              role="tab"
              aria-selected={r.id === activeRoom.id}
              className={`sc-tab${r.id === activeRoom.id ? " is-active" : ""}`}
              onClick={() => setRoomId(r.id)}
            >
              {r.name}
            </button>
          ))}
        </div>
      )}

      <div className="sc-floor-stage">
        <ServiceCanvas key={activeRoom.id} room={activeRoom} />
      </div>

      {/* The scrubber answers "can I fit a six-top at 8:30" without opening
          anything. It reads from data already loaded, so dragging it never
          fires a request. */}
      <div className="sc-scrubber">
        <label htmlFor="sc-scrub" className="sc-scrub-label fp-num">
          {formatHHMM(at)}
          {scrubMinutes === null && <span className="sc-scrub-live"> live</span>}
        </label>
        <input
          id="sc-scrub"
          className="sc-scrub-input"
          type="range"
          min={bounds.from}
          max={bounds.to}
          step={15}
          value={at}
          onChange={(e) => setScrub(Number(e.target.value))}
        />
        {scrubMinutes !== null && (
          <button
            type="button"
            className="sc-action"
            onClick={() => setScrub(null)}
          >
            Now
          </button>
        )}
      </div>
    </div>
  );
}
