"use client";

import { memo, useCallback, useMemo, useRef, useState } from "react";
import type { Reservation } from "@lead-intake/shared-types";
import { patchReservation } from "../api/console";
import { formatHHMM, occupies, parseHHMM, STATUS_META, deriveTableStatus } from "./status";
import {
  selectReservationList,
  useServiceConsole,
} from "../store/service-console-store";

/**
 * Tables down the left, time across the top, bookings as blocks.
 *
 * Built for a full Saturday — roughly 80 bookings across 28 tables — so the
 * grid lines are a CSS background rather than elements. That keeps the tree at
 * about 110 nodes (28 row headers plus the blocks) instead of the ~750 a cell
 * per interval would cost. Rows are memoised, so one SSE event re-renders one
 * row rather than the whole grid.
 *
 * Deliberately not virtualised: 28 rows is small, and windowing would break
 * both the sticky headers and dragging a block across rows. Worth revisiting
 * past roughly 150 tables.
 */

/** Width of one slot column, in CSS px. */
const COL_PX = 56;
const SLOT_MIN = 15;
const ROW_PX = 44;

type DragState = {
  reservationId: string;
  startClientX: number;
  startClientY: number;
  deltaCols: number;
  targetTableId: string | null;
} | null;

export function TimelineView() {
  const reservations = useServiceConsole(selectReservationList);
  const floorPlan = useServiceConsole((s) => s.floorPlan);
  const day = useServiceConsole((s) => s.day);
  const select = useServiceConsole((s) => s.select);
  const nowMinutes = useServiceConsole((s) => s.nowMinutes);
  const load = useServiceConsole((s) => s.load);

  const [drag, setDrag] = useState<DragState>(null);
  const [rejection, setRejection] = useState<string | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);

  const bounds = useMemo(() => {
    if (!day || day.periods.length === 0) return { from: 17 * 60, to: 23 * 60 };
    return {
      from: Math.min(...day.periods.map((p) => parseHHMM(p.startTime))),
      to: Math.max(...day.periods.map((p) => parseHHMM(p.endTime))),
    };
  }, [day]);

  const columns = Math.max(1, Math.ceil((bounds.to - bounds.from) / SLOT_MIN));

  const tables = useMemo(
    () =>
      (floorPlan?.rooms ?? [])
        .filter((r) => r.isActive)
        .flatMap((r) => r.tables.map((t) => ({ ...t, roomName: r.name })))
        .filter((t) => t.isActive),
    [floorPlan]
  );

  const byTable = useMemo(() => {
    const map = new Map<string, Reservation[]>();
    for (const r of reservations) {
      if (!occupies(r)) continue;
      for (const tableId of r.tableIds) {
        const list = map.get(tableId);
        if (list) list.push(r);
        else map.set(tableId, [r]);
      }
    }
    return map;
  }, [reservations]);

  /**
   * The same overlap rule the server runs: adjacency is not conflict. Checked
   * here so a bad drop is refused with an explanation instead of round-tripping
   * — but the server stays authoritative and a 409 still rolls the block back.
   */
  const conflictOn = useCallback(
    (tableId: string, start: number, end: number, ignoreId: string) => {
      for (const r of byTable.get(tableId) ?? []) {
        if (r.id === ignoreId) continue;
        const rs = parseHHMM(r.startTime);
        const re = parseHHMM(r.endTime);
        if (!(re <= start || rs >= end)) return r;
      }
      return null;
    },
    [byTable]
  );

  const commitDrag = useCallback(
    async (state: NonNullable<DragState>) => {
      const reservation = useServiceConsole.getState().reservations[
        state.reservationId
      ];
      if (!reservation) return;

      const newStart = parseHHMM(reservation.startTime) + state.deltaCols * SLOT_MIN;
      const duration =
        parseHHMM(reservation.endTime) - parseHHMM(reservation.startTime);
      const targetTable = state.targetTableId ?? reservation.tableIds[0];

      if (newStart < bounds.from || newStart + duration > bounds.to) {
        setRejection("That would fall outside service hours.");
        return;
      }

      const clash = conflictOn(
        targetTable,
        newStart,
        newStart + duration,
        reservation.id
      );
      const timeChanged = newStart !== parseHHMM(reservation.startTime);
      const tableChanged = targetTable !== reservation.tableIds[0];

      // Same-slot table swap is allowed; overlapping a different time is not.
      if (clash && (timeChanged || !tableChanged)) {
        setRejection(
          `Table ${targetTable.replace(/^tbl-/, "")} already has ${clash.guestName} at ${clash.startTime}.`
        );
        return;
      }

      if (timeChanged) {
        const result = await patchReservation(reservation.id, {
          startTime: formatHHMM(newStart),
        });
        if (!result.ok) {
          setRejection(result.error);
          await load();
          return;
        }
      }
      if (tableChanged) {
        if (clash) {
          await useServiceConsole.getState().reassign(reservation.id, [targetTable], {
            swapWithReservationId: clash.id,
          });
        } else {
          await useServiceConsole.getState().reassign(reservation.id, [targetTable]);
        }
      }
      await load();
    },
    [bounds, conflictOn, load]
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!drag) return;
      const dx = e.clientX - drag.startClientX;
      const dy = e.clientY - drag.startClientY;
      const deltaCols = Math.round(dx / COL_PX);
      const rowShift = Math.round(dy / ROW_PX);

      const current = useServiceConsole.getState().reservations[drag.reservationId];
      const fromIndex = tables.findIndex(
        (t) => t.id === current?.tableIds[0]
      );
      const targetIndex = Math.min(
        Math.max(0, fromIndex + rowShift),
        tables.length - 1
      );

      setDrag({
        ...drag,
        deltaCols,
        targetTableId: tables[targetIndex]?.id ?? null,
      });
    },
    [drag, tables]
  );

  const onPointerUp = useCallback(() => {
    if (!drag) return;
    const state = drag;
    setDrag(null);
    if (state.deltaCols !== 0 || state.targetTableId) {
      void commitDrag(state);
    }
  }, [commitDrag, drag]);

  if (tables.length === 0) {
    return <p className="sc-empty">No tables in the floor plan yet.</p>;
  }

  return (
    <div className="sc-timeline-wrap">
      {rejection && (
        <div className="sc-notice sc-notice-error" role="alert">
          <span>{rejection}</span>
          <button
            type="button"
            className="sc-action"
            onClick={() => setRejection(null)}
          >
            Dismiss
          </button>
        </div>
      )}

      <div
        className="sc-timeline"
        ref={gridRef}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => setDrag(null)}
      >
        <div className="sc-timeline-corner" />

        <div
          className="sc-timeline-times"
          style={{
            gridTemplateColumns: `repeat(${columns}, ${COL_PX}px)`,
          }}
        >
          {Array.from({ length: columns }, (_, i) => {
            const minutes = bounds.from + i * SLOT_MIN;
            const onHour = minutes % 60 === 0;
            return (
              <span
                key={minutes}
                className={`sc-timeline-time fp-num${onHour ? " is-hour" : ""}`}
              >
                {onHour ? formatHHMM(minutes) : ""}
              </span>
            );
          })}
        </div>

        <div className="sc-timeline-labels">
          {tables.map((t) => (
            <span key={t.id} className="sc-timeline-label fp-num">
              {t.label}
            </span>
          ))}
        </div>

        <div
          className="sc-timeline-body"
          style={{
            gridTemplateColumns: `repeat(${columns}, ${COL_PX}px)`,
            // Grid lines as a background, so the columns cost zero elements.
            backgroundSize: `${COL_PX}px ${ROW_PX}px`,
          }}
        >
          {tables.map((table, rowIndex) => (
            <TimelineRow
              key={table.id}
              rowIndex={rowIndex}
              tableId={table.id}
              bookings={byTable.get(table.id) ?? []}
              from={bounds.from}
              columns={columns}
              nowMinutes={nowMinutes}
              dragging={drag}
              onSelect={select}
              onDragStart={(reservationId, e) =>
                setDrag({
                  reservationId,
                  startClientX: e.clientX,
                  startClientY: e.clientY,
                  deltaCols: 0,
                  targetTableId: table.id,
                })
              }
            />
          ))}

          {nowMinutes >= bounds.from && nowMinutes <= bounds.to && (
            <div
              className="sc-timeline-now"
              style={{
                gridColumn: `${Math.floor((nowMinutes - bounds.from) / SLOT_MIN) + 1} / span 1`,
                gridRow: `1 / ${tables.length + 1}`,
              }}
              aria-hidden="true"
            />
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * One table's row. Memoised on its bookings, so an event touching a single
 * booking re-renders one row rather than all 28.
 */
const TimelineRow = memo(function TimelineRow({
  rowIndex,
  tableId,
  bookings,
  from,
  columns,
  nowMinutes,
  dragging,
  onSelect,
  onDragStart,
}: {
  rowIndex: number;
  tableId: string;
  bookings: Reservation[];
  from: number;
  columns: number;
  nowMinutes: number;
  dragging: DragState;
  onSelect: (id: string) => void;
  onDragStart: (id: string, e: React.PointerEvent<HTMLButtonElement>) => void;
}) {
  return (
    <>
      {bookings.map((r) => {
        const start = parseHHMM(r.startTime);
        const end = parseHHMM(r.endTime);
        const startCol = Math.floor((start - from) / SLOT_MIN) + 1;
        const span = Math.max(1, Math.round((end - start) / SLOT_MIN));
        if (startCol < 1 || startCol > columns) return null;

        const isDragging = dragging?.reservationId === r.id;
        const status = deriveTableStatus({ reservation: r, nowMinutes });

        return (
          <button
            key={r.id}
            type="button"
            className={`sc-block sc-block-${status}${isDragging ? " is-dragging" : ""}`}
            style={{
              gridColumn: `${startCol} / span ${Math.min(span, columns - startCol + 1)}`,
              gridRow: `${rowIndex + 1} / span 1`,
              // Movement during a drag is transform-only: no layout per frame.
              transform: isDragging
                ? `translateX(${dragging.deltaCols * COL_PX}px)`
                : undefined,
            }}
            aria-label={`${r.guestName}, ${r.partySize} covers, ${r.startTime} to ${r.endTime}, table ${tableId.replace(/^tbl-/, "")}, ${STATUS_META[status].label}`}
            onClick={() => onSelect(r.id)}
            onPointerDown={(e) => onDragStart(r.id, e)}
          >
            <span className="sc-block-name">{r.guestName}</span>
            <span className="sc-block-party fp-num">{r.partySize}</span>
            {r.allergies?.trim() && (
              <span className="sc-block-allergy" aria-hidden="true">
                !
              </span>
            )}
          </button>
        );
      })}
    </>
  );
});
