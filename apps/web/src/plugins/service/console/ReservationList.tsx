"use client";

import { useMemo, useState } from "react";
import type { Reservation } from "@lead-intake/shared-types";
import { STATUS_META, deriveTableStatus, parseHHMM } from "./status";
import {
  selectReservationList,
  useServiceConsole,
} from "../store/service-console-store";

type Filter = "all" | "unassigned" | "allergies" | "vip" | "large";

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "unassigned", label: "Unassigned" },
  { id: "allergies", label: "Allergies" },
  { id: "vip", label: "VIP" },
  { id: "large", label: "Large parties" },
];

const LARGE_PARTY = 6;

/** Reservations grouped by time, the screen a manager leaves open all shift. */
export function ReservationList() {
  const reservations = useServiceConsole(selectReservationList);
  const selectedId = useServiceConsole((s) => s.selectedId);
  const select = useServiceConsole((s) => s.select);
  const [filter, setFilter] = useState<Filter>("all");

  const groups = useMemo(() => {
    const filtered = reservations.filter((r) => {
      switch (filter) {
        case "unassigned":
          return r.tableIds.length === 0;
        case "allergies":
          return Boolean(r.allergies?.trim());
        case "vip":
          return r.tags.includes("vip");
        case "large":
          return r.partySize >= LARGE_PARTY;
        default:
          return true;
      }
    });

    const byTime = new Map<string, Reservation[]>();
    for (const r of filtered) {
      const list = byTime.get(r.startTime);
      if (list) list.push(r);
      else byTime.set(r.startTime, [r]);
    }
    return [...byTime.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [reservations, filter]);

  return (
    <section className="sc-list" aria-label="Reservations">
      <div className="sc-filters" role="group" aria-label="Filter reservations">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            className={`sc-filter${filter === f.id ? " is-active" : ""}`}
            aria-pressed={filter === f.id}
            onClick={() => setFilter(f.id)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {groups.length === 0 ? (
        <p className="sc-empty">No reservations match.</p>
      ) : (
        <ol className="sc-groups">
          {groups.map(([time, rows]) => (
            <li key={time} className="sc-group">
              <h3 className="sc-group-time fp-num">{time}</h3>
              <ol className="sc-rows">
                {rows.map((r) => (
                  <ReservationRow
                    key={r.id}
                    reservation={r}
                    active={r.id === selectedId}
                    onSelect={() => select(r.id)}
                  />
                ))}
              </ol>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function ReservationRow({
  reservation,
  active,
  onSelect,
}: {
  reservation: Reservation;
  active: boolean;
  onSelect: () => void;
}) {
  const nowMinutes = useServiceConsole((s) => s.nowMinutes);
  const pending = useServiceConsole((s) => Boolean(s.pending[reservation.id]));
  const act = useServiceConsole((s) => s.act);

  const status = deriveTableStatus({ reservation, nowMinutes });
  const meta = STATUS_META[status];
  const allergy = reservation.allergies?.trim();

  return (
    <li>
      <div
        className={`sc-row${active ? " is-active" : ""}${pending ? " is-pending" : ""}`}
      >
        <button
          type="button"
          className="sc-row-main"
          aria-current={active}
          onClick={onSelect}
        >
          <span className="sc-row-top">
            <span className="sc-row-name">{reservation.guestName}</span>
            <span className="sc-row-party fp-num">{reservation.partySize}</span>
          </span>
          <span className="sc-row-bottom">
            {/* Status as a word, never colour alone. */}
            <span className={`sc-status sc-status-${status}`}>{meta.label}</span>
            <span className="sc-row-table fp-num">
              {reservation.tableIds.length > 0
                ? reservation.tableIds.length === 1
                  ? `Table ${reservation.tableIds[0].replace(/^tbl-/, "")}`
                  : `${reservation.tableIds.length} tables`
                : "Unassigned"}
            </span>
          </span>
          {(allergy || reservation.tags.length > 0 || reservation.occasion) && (
            <span className="sc-tags">
              {/* Allergy tags are non-dismissable and high contrast (§12). */}
              {allergy && (
                <span className="sc-tag sc-tag-allergy">Allergy: {allergy}</span>
              )}
              {reservation.occasion && (
                <span className="sc-tag">{reservation.occasion}</span>
              )}
              {reservation.tags.map((tag) => (
                <span key={tag} className="sc-tag">
                  {tag.replace(/_/g, " ")}
                </span>
              ))}
            </span>
          )}
        </button>

        <div className="sc-row-actions">
          {reservation.status === "confirmed" && (
            <>
              <button
                type="button"
                className="sc-action"
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
      </div>
    </li>
  );
}

export { parseHHMM };
