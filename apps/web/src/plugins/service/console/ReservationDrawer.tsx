"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { patchGuestProfile, patchReservation } from "../api/console";
import { STATUS_META, deriveTableStatus } from "./status";
import {
  selectSelected,
  useServiceConsole,
} from "../store/service-console-store";
import { GuestContactPanel } from "./GuestContactPanel";

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
  const guestProfile = useServiceConsole((s) =>
    reservation ? s.guestProfiles[reservation.id] ?? null : null
  );
  const payment = useServiceConsole((s) =>
    reservation ? s.payments[reservation.id] ?? null : null
  );
  const events = useServiceConsole((s) => s.drawerEvents);
  const pending = useServiceConsole((s) =>
    reservation ? Boolean(s.pending[reservation.id]) : false
  );
  const remoteChange = useServiceConsole((s) => s.remoteChangeNotice);
  const acknowledge = useServiceConsole((s) => s.acknowledgeRemoteChange);
  const setDrawerDirty = useServiceConsole((s) => s.setDrawerDirty);
  const markLocalMutation = useServiceConsole((s) => s.markLocalMutation);
  const refetchOne = useServiceConsole((s) => s.refetchOne);
  const reassign = useServiceConsole((s) => s.reassign);
  const reservations = useServiceConsole((s) => s.reservations);
  const floorPlan = useServiceConsole((s) => s.floorPlan);
  const act = useServiceConsole((s) => s.act);
  const select = useServiceConsole((s) => s.select);
  const nowMinutes = useServiceConsole((s) => s.nowMinutes);

  const [notes, setNotes] = useState("");
  const [notesDirty, setNotesDirty] = useState(false);
  const [guestName, setGuestName] = useState("");
  const [guestPhone, setGuestPhone] = useState("");
  const [guestEmail, setGuestEmail] = useState("");
  const [partySize, setPartySize] = useState(2);
  const [allergies, setAllergies] = useState("");
  const [infoDirty, setInfoDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [vipSaving, setVipSaving] = useState(false);
  const [swapTableId, setSwapTableId] = useState("");
  const loadedFor = useRef<string | null>(null);

  // Seed editable fields once per reservation. Re-seeding on every store
  // change is exactly what would wipe someone's typing.
  useEffect(() => {
    if (!reservation) return;
    if (loadedFor.current === reservation.id) return;
    loadedFor.current = reservation.id;
    setNotes(reservation.staffNotes ?? "");
    setNotesDirty(false);
    setGuestName(reservation.guestName);
    setGuestPhone(reservation.guestPhone ?? "");
    setGuestEmail(reservation.guestEmail ?? "");
    setPartySize(reservation.partySize);
    setAllergies(reservation.allergies ?? "");
    setInfoDirty(false);
    setDrawerDirty(false);
    setSwapTableId("");
  }, [reservation, setDrawerDirty]);

  useEffect(() => {
    setDrawerDirty(notesDirty || infoDirty);
  }, [notesDirty, infoDirty, setDrawerDirty]);

  const tables = useMemo(() => {
    if (!floorPlan) return [];
    return floorPlan.rooms.flatMap((r) => r.tables);
  }, [floorPlan]);

  const swapCandidates = useMemo(() => {
    if (!reservation) return [];
    return Object.values(reservations).filter(
      (r) =>
        r.id !== reservation.id &&
        r.serviceDate === reservation.serviceDate &&
        r.tableIds.length > 0 &&
        r.status !== "cancelled" &&
        r.status !== "finished" &&
        r.status !== "no_show" &&
        r.status !== "expired"
    );
  }, [reservation, reservations]);

  if (!reservation) {
    return (
      <aside className="sc-drawer sc-drawer-empty" aria-label="Reservation detail">
        <p className="sc-empty">Select a booking to see its detail.</p>
      </aside>
    );
  }

  const status = deriveTableStatus({ reservation, nowMinutes });
  const allergy = reservation.allergies?.trim();
  const guestNotes = reservation.guestNotes?.trim();

  const saveNotes = async () => {
    setSaving(true);
    markLocalMutation(reservation.id);
    const result = await patchReservation(reservation.id, { staffNotes: notes });
    setSaving(false);
    if (result.ok) {
      setNotesDirty(false);
      void refetchOne(reservation.id);
    }
  };

  const saveGuestInfo = async () => {
    setSaving(true);
    markLocalMutation(reservation.id);
    const result = await patchReservation(reservation.id, {
      guestName: guestName.trim() || reservation.guestName,
      guestPhone: guestPhone.trim() || null,
      guestEmail: guestEmail.trim() || null,
      partySize,
      allergies: allergies.trim() || null,
    });
    setSaving(false);
    if (result.ok) {
      setInfoDirty(false);
      void refetchOne(reservation.id);
    }
  };

  const toggleVip = async () => {
    if (!guestProfile || !reservation.contactId) return;
    setVipSaving(true);
    markLocalMutation(reservation.id);
    const result = await patchGuestProfile(reservation.id, {
      vip: !guestProfile.vip,
    });
    setVipSaving(false);
    if (result.ok) void refetchOne(reservation.id);
  };

  const moveOrSwap = async () => {
    if (!swapTableId) return;
    const occupant = swapCandidates.find((r) => r.tableIds.includes(swapTableId));
    markLocalMutation(reservation.id);
    if (occupant) {
      markLocalMutation(occupant.id);
      await reassign(reservation.id, [swapTableId], {
        swapWithReservationId: occupant.id,
      });
    } else {
      await reassign(reservation.id, [swapTableId]);
    }
    setSwapTableId("");
  };

  const reliabilityLabel =
    guestProfile?.reliabilityChip === "good"
      ? "Good"
      : guestProfile?.reliabilityChip === "watch"
        ? "Watch"
        : guestProfile?.reliabilityChip === "risk"
          ? "Risk"
          : null;

  const formatPence = (pence: number) =>
    new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency: "GBP",
    }).format(pence / 100);

  const tableLabel = (id: string) => id.replace(/^tbl-/, "");

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

      {remoteChange && (
        <div className="sc-notice" role="status">
          <span>Updated on another device — reload if your edits look wrong.</span>
          <button
            type="button"
            className="sc-action"
            onClick={() => {
              void refetchOne(reservation.id);
              if (!notesDirty && !infoDirty) {
                loadedFor.current = null;
              }
              acknowledge();
            }}
          >
            Reload
          </button>
        </div>
      )}

      {(allergy || guestNotes) && (
        <div className="sc-guest-flags" role="note">
          {allergy && (
            <p className="sc-allergy">
              Allergy: {allergy}
            </p>
          )}
          {guestNotes && (
            <p className="sc-guest-notes">
              <span className="sc-guest-notes-label">Guest notes</span>
              {guestNotes}
            </p>
          )}
        </div>
      )}

      {guestProfile && (
        <div className="sc-guest-profile">
          <label className="sc-vip-toggle">
            <input
              type="checkbox"
              checked={guestProfile.vip}
              disabled={vipSaving || !reservation.contactId}
              onChange={() => void toggleVip()}
            />
            <span>VIP guest</span>
          </label>
          {reliabilityLabel && (
            <span
              className={`sc-reliability sc-reliability-${guestProfile.reliabilityChip}`}
            >
              {reliabilityLabel} · {guestProfile.reliabilityScore}
            </span>
          )}
        </div>
      )}

      {payment && (
        <p className="sc-deposit" role="status">
          Deposit: {formatPence(payment.amountPence)} ·{" "}
          {payment.status.replace(/_/g, " ")}
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
              ? reservation.tableIds.map(tableLabel).join(", ")
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
        {reservation.status === "pending_payment" && (
          <p className="sc-hint">Awaiting deposit payment</p>
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

      <div className="sc-field sc-table-swap">
        <label htmlFor="sc-swap-table">Move / swap table</label>
        <div className="sc-swap-row">
          <select
            id="sc-swap-table"
            className="sc-select"
            value={swapTableId}
            onChange={(e) => setSwapTableId(e.target.value)}
          >
            <option value="">Choose table…</option>
            {tables.map((t) => {
              const occupant = swapCandidates.find((r) =>
                r.tableIds.includes(t.id)
              );
              const isCurrent = reservation.tableIds.includes(t.id);
              return (
                <option key={t.id} value={t.id} disabled={isCurrent}>
                  {t.label || tableLabel(t.id)}
                  {occupant
                    ? ` · swap with ${occupant.guestName}`
                    : isCurrent
                      ? " · current"
                      : " · free"}
                </option>
              );
            })}
          </select>
          <button
            type="button"
            className="sc-action"
            disabled={!swapTableId || pending}
            onClick={() => void moveOrSwap()}
          >
            {swapCandidates.some((r) => r.tableIds.includes(swapTableId))
              ? "Swap"
              : "Move"}
          </button>
        </div>
        <p className="sc-hint">
          Or drag a chip onto an occupied table on the floor to swap.
        </p>
      </div>

      <fieldset className="sc-field sc-guest-edit">
        <legend>Guest info</legend>
        <label className="sc-inline-label" htmlFor="sc-guest-name">
          Name
          <input
            id="sc-guest-name"
            className="sc-input"
            value={guestName}
            onChange={(e) => {
              setGuestName(e.target.value);
              setInfoDirty(true);
            }}
          />
        </label>
        <label className="sc-inline-label" htmlFor="sc-guest-phone">
          Phone
          <input
            id="sc-guest-phone"
            className="sc-input"
            inputMode="tel"
            value={guestPhone}
            onChange={(e) => {
              setGuestPhone(e.target.value);
              setInfoDirty(true);
            }}
          />
        </label>
        <label className="sc-inline-label" htmlFor="sc-guest-email">
          Email
          <input
            id="sc-guest-email"
            className="sc-input"
            inputMode="email"
            value={guestEmail}
            onChange={(e) => {
              setGuestEmail(e.target.value);
              setInfoDirty(true);
            }}
          />
        </label>
        <label className="sc-inline-label" htmlFor="sc-party-size">
          Covers
          <input
            id="sc-party-size"
            className="sc-input"
            type="number"
            min={1}
            max={100}
            value={partySize}
            onChange={(e) => {
              setPartySize(Number(e.target.value) || 1);
              setInfoDirty(true);
            }}
          />
        </label>
        <label className="sc-inline-label" htmlFor="sc-allergies">
          Allergies
          <input
            id="sc-allergies"
            className="sc-input"
            value={allergies}
            onChange={(e) => {
              setAllergies(e.target.value);
              setInfoDirty(true);
            }}
          />
        </label>
        {infoDirty && (
          <button
            type="button"
            className="sc-action"
            disabled={saving}
            onClick={() => void saveGuestInfo()}
          >
            {saving ? "Saving" : "Save guest info"}
          </button>
        )}
      </fieldset>

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

      <GuestContactPanel
        reservationId={reservation.id}
        guestEmail={reservation.guestEmail}
      />

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
