"use client";

import { useEffect, useRef, useState } from "react";
import { patchReservation } from "../api/console";
import { STATUS_META, deriveTableStatus } from "./status";
import {
  selectSelected,
  useServiceConsole,
} from "../store/service-console-store";

/**
 * Detail for the selected reservation.
 *
 * The drawer renders from the store by id and never holds its own copy, so a
 * change arriving over SSE cannot leave stale data on screen. What it *does*
 * hold locally is whatever the manager is currently typing — and that is never
 * overwritten by a remote change. Discarding a half-typed allergy note
 * mid-service is worse than briefly showing two versions of the truth.
 */
export function ReservationDrawer() {
  const reservation = useServiceConsole(selectSelected);
  const events = useServiceConsole((s) => s.drawerEvents);
  const pending = useServiceConsole((s) =>
    reservation ? Boolean(s.pending[reservation.id]) : false
  );
  const remoteChange = useServiceConsole((s) => s.remoteChangeNotice);
  const acknowledge = useServiceConsole((s) => s.acknowledgeRemoteChange);
  const refetchOne = useServiceConsole((s) => s.refetchOne);
  const act = useServiceConsole((s) => s.act);
  const select = useServiceConsole((s) => s.select);
  const nowMinutes = useServiceConsole((s) => s.nowMinutes);

  const [notes, setNotes] = useState("");
  const [notesDirty, setNotesDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const loadedFor = useRef<string | null>(null);

  // Seed the editable field once per reservation. Re-seeding on every store
  // change is exactly what would wipe someone's typing.
  useEffect(() => {
    if (!reservation) return;
    if (loadedFor.current === reservation.id) return;
    loadedFor.current = reservation.id;
    setNotes(reservation.staffNotes ?? "");
    setNotesDirty(false);
  }, [reservation]);

  if (!reservation) {
    return (
      <aside className="sc-drawer sc-drawer-empty" aria-label="Reservation detail">
        <p className="sc-empty">Select a booking to see its detail.</p>
      </aside>
    );
  }

  const status = deriveTableStatus({ reservation, nowMinutes });
  const allergy = reservation.allergies?.trim();

  const saveNotes = async () => {
    setSaving(true);
    const result = await patchReservation(reservation.id, { staffNotes: notes });
    setSaving(false);
    if (result.ok) {
      setNotesDirty(false);
      void refetchOne(reservation.id);
    }
  };

  return (
    <aside
      className="sc-drawer"
      aria-label={`Reservation for ${reservation.guestName}`}
    >
      <header className="sc-drawer-head">
        <div>
          <h2 className="sc-drawer-name">{reservation.guestName}</h2>
          <p className="sc-drawer-sub fp-num">
            {reservation.startTime}–{reservation.endTime} · {reservation.partySize}{" "}
            covers · {reservation.reference}
          </p>
        </div>
        <button
          type="button"
          className="sc-icon-btn"
          aria-label="Close detail"
          onClick={() => select(null)}
        >
          ×
        </button>
      </header>

      {/* Server truth, even while something local is unsaved. */}
      {remoteChange && (
        <div className="sc-notice" role="status">
          <span>This booking was changed elsewhere.</span>
          <button
            type="button"
            className="sc-action"
            onClick={() => {
              void refetchOne(reservation.id);
              if (!notesDirty) {
                loadedFor.current = null;
              }
              acknowledge();
            }}
          >
            Reload
          </button>
        </div>
      )}

      {allergy && (
        <p className="sc-allergy" role="note">
          Allergy: {allergy}
        </p>
      )}

      <dl className="sc-facts">
        <div>
          <dt>Status</dt>
          <dd>
            <span className={`sc-status sc-status-${status}`}>
              {STATUS_META[status].label}
            </span>
          </dd>
        </div>
        <div>
          <dt>Tables</dt>
          <dd className="fp-num">
            {reservation.tableIds.length
              ? reservation.tableIds.map((t) => t.replace(/^tbl-/, "")).join(", ")
              : "Unassigned"}
            {reservation.assignmentLocked && (
              <span className="sc-lock" title="Locked by a manager">
                {" "}
                locked
              </span>
            )}
          </dd>
        </div>
        <div>
          <dt>Phone</dt>
          <dd className="fp-num">{reservation.guestPhone ?? "—"}</dd>
        </div>
        <div>
          <dt>Source</dt>
          <dd>{reservation.source.replace(/_/g, " ")}</dd>
        </div>
        {reservation.occasion && (
          <div>
            <dt>Occasion</dt>
            <dd>{reservation.occasion}</dd>
          </div>
        )}
      </dl>

      <div className="sc-drawer-actions">
        {reservation.status === "confirmed" && (
          <>
            <button
              type="button"
              className="sc-action sc-action-primary"
              disabled={pending}
              onClick={() => void act(reservation.id, "seat")}
            >
              Seat
            </button>
            <button
              type="button"
              className="sc-action"
              disabled={pending}
              onClick={() => void act(reservation.id, "no_show")}
            >
              No-show
            </button>
          </>
        )}
        {reservation.status === "seated" && (
          <button
            type="button"
            className="sc-action sc-action-primary"
            disabled={pending}
            onClick={() => void act(reservation.id, "finish")}
          >
            Finish
          </button>
        )}
        {reservation.status !== "cancelled" &&
          reservation.status !== "finished" && (
            <button
              type="button"
              className="sc-action sc-action-danger"
              disabled={pending}
              onClick={() => void act(reservation.id, "cancel")}
            >
              Cancel
            </button>
          )}
        {(reservation.status === "cancelled" ||
          reservation.status === "no_show") && (
          <button
            type="button"
            className="sc-action"
            disabled={pending}
            onClick={() => void act(reservation.id, "reinstate")}
          >
            Reinstate
          </button>
        )}
      </div>

      <div className="sc-field">
        <label htmlFor="sc-notes">Staff notes</label>
        <textarea
          id="sc-notes"
          className="sc-textarea"
          rows={3}
          value={notes}
          onChange={(e) => {
            setNotes(e.target.value);
            setNotesDirty(true);
          }}
        />
        {notesDirty && (
          <button
            type="button"
            className="sc-action"
            disabled={saving}
            onClick={() => void saveNotes()}
          >
            {saving ? "Saving" : "Save note"}
          </button>
        )}
      </div>

      {events.length > 0 && (
        <section className="sc-log" aria-label="Event log">
          <h3 className="sc-log-title">History</h3>
          <ol className="sc-log-list">
            {events.map((e) => (
              <li key={e.id}>
                <span className="sc-log-type">{e.type.replace(/[._]/g, " ")}</span>
                <span className="sc-log-actor">{e.actor.replace(/^staff:/, "")}</span>
              </li>
            ))}
          </ol>
        </section>
      )}
    </aside>
  );
}
