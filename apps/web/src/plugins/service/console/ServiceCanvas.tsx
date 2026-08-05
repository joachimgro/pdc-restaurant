"use client";

import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { Reservation } from "@lead-intake/shared-types";
import { FloorCanvasShell } from "../canvas/FloorCanvasShell";
import { useCanvasViewport } from "../canvas/useCanvasViewport";
import { distance } from "../geometry";
import { StatusBadge } from "./StatusBadge";
import {
  deriveTableStatus,
  reservationAt,
  serviceTableName,
  STATUS_META,
  type TableStatus,
} from "./status";
import {
  selectReservationList,
  useServiceConsole,
} from "../store/service-console-store";
import type { RoomMeta } from "../types";

/**
 * Service mode on the Phase 2 canvas.
 *
 * Shares FloorCanvasShell and useCanvasViewport with layout mode, so pinch,
 * two-finger pan and the 44px touch targets behave identically. Only what a
 * single pointer *means* differs, and that lives here.
 */

const DRAG_THRESHOLD_PX = 6;
const LONG_PRESS_MS = 500;

type Gesture =
  | { kind: "none" }
  | {
      kind: "pending";
      tableId: string;
      startClient: { x: number; y: number };
    }
  | {
      kind: "chip";
      reservationId: string;
      fromTableId: string;
      at: { x: number; y: number };
    };

export function ServiceCanvas({ room }: { room: RoomMeta }) {
  const gestureRef = useRef<Gesture>({ kind: "none" });
  const longPressRef = useRef<number | null>(null);
  const [dragging, setDragging] = useState<{
    reservationId: string;
    x: number;
    y: number;
    overTableId: string | null;
  } | null>(null);

  const reservations = useServiceConsole(selectReservationList);
  const floorPlan = useServiceConsole((s) => s.floorPlan);
  const nowMinutes = useServiceConsole((s) => s.nowMinutes);
  const scrubMinutes = useServiceConsole((s) => s.scrubMinutes);
  const select = useServiceConsole((s) => s.select);
  const selectedId = useServiceConsole((s) => s.selectedId);
  const reassign = useServiceConsole((s) => s.reassign);

  const atMinutes = scrubMinutes ?? nowMinutes;

  const clearLongPress = useCallback(() => {
    if (longPressRef.current !== null) {
      window.clearTimeout(longPressRef.current);
      longPressRef.current = null;
    }
  }, []);

  const abort = useCallback(() => {
    gestureRef.current = { kind: "none" };
    setDragging(null);
    clearLongPress();
  }, [clearLongPress]);

  const view = useCanvasViewport({ room, onMultiTouchStart: abort });

  const tables = useMemo(
    () => floorPlan?.rooms.find((r) => r.id === room.id)?.tables ?? [],
    [floorPlan, room.id]
  );

  /** Bookings on each table, resolved once per render rather than per table. */
  const byTable = useMemo(() => {
    const map = new Map<string, Reservation[]>();
    for (const r of reservations) {
      for (const tableId of r.tableIds) {
        const list = map.get(tableId);
        if (list) list.push(r);
        else map.set(tableId, [r]);
      }
    }
    return map;
  }, [reservations]);

  const tableAtPoint = useCallback(
    (canvasX: number, canvasY: number): string | null => {
      for (const t of tables) {
        if (
          canvasX >= t.posX &&
          canvasX <= t.posX + t.width &&
          canvasY >= t.posY &&
          canvasY <= t.posY + t.height
        ) {
          return t.id;
        }
      }
      return null;
    },
    [tables]
  );

  const handlePointerDown = useCallback(
    (e: ReactPointerEvent<SVGElement>, tableId: string | null) => {
      if (!tableId) return;
      gestureRef.current = {
        kind: "pending",
        tableId,
        startClient: { x: e.clientX, y: e.clientY },
      };

      const booking = reservationAt(byTable.get(tableId) ?? [], atMinutes);
      if (!booking) return;

      clearLongPress();
      longPressRef.current = window.setTimeout(() => {
        // Long press on an occupied table picks up its booking chip; a plain
        // tap opens the sheet. Separating them stops a scroll from becoming a
        // reassignment.
        if (gestureRef.current.kind !== "pending") return;
        const point = view.toCanvas(e.clientX, e.clientY);
        if (!point) return;
        gestureRef.current = {
          kind: "chip",
          reservationId: booking.id,
          fromTableId: tableId,
          at: point,
        };
        setDragging({
          reservationId: booking.id,
          x: point.x,
          y: point.y,
          overTableId: tableId,
        });
      }, LONG_PRESS_MS);
    },
    [atMinutes, byTable, clearLongPress, view]
  );

  const handlePointerMove = useCallback(
    (e: ReactPointerEvent<SVGElement>) => {
      const gesture = gestureRef.current;

      if (gesture.kind === "pending") {
        const moved = distance(gesture.startClient, {
          x: e.clientX,
          y: e.clientY,
        });
        // Movement before the long press fires means a pan, not a pick-up.
        if (moved > DRAG_THRESHOLD_PX) clearLongPress();
        return;
      }

      if (gesture.kind === "chip") {
        const point = view.toCanvas(e.clientX, e.clientY);
        if (!point) return;
        setDragging({
          reservationId: gesture.reservationId,
          x: point.x,
          y: point.y,
          overTableId: tableAtPoint(point.x, point.y),
        });
      }
    },
    [clearLongPress, tableAtPoint, view]
  );

  const handlePointerUp = useCallback(
    (e: ReactPointerEvent<SVGElement>) => {
      const gesture = gestureRef.current;
      clearLongPress();

      if (gesture.kind === "pending") {
        const booking = reservationAt(
          byTable.get(gesture.tableId) ?? [],
          atMinutes
        );
        // Tapping an empty table is how a walk-in gets seated; the workspace
        // opens the booking form pre-filled with it.
        select(booking ? booking.id : null);
        gestureRef.current = { kind: "none" };
        return;
      }

      if (gesture.kind === "chip") {
        const point = view.toCanvas(e.clientX, e.clientY);
        const target = point ? tableAtPoint(point.x, point.y) : null;
        if (target && target !== gesture.fromTableId) {
          // Optimistic with rollback — the store puts the booking back and
          // explains if the server rejects the move.
          void reassign(gesture.reservationId, [target]);
        }
        setDragging(null);
        gestureRef.current = { kind: "none" };
      }
    },
    [atMinutes, byTable, clearLongPress, reassign, select, tableAtPoint, view]
  );

  return (
    <FloorCanvasShell
      room={room}
      view={view}
      ariaLabel={`${room.name} service floor, ${tables.length} tables`}
      className="sc-canvas"
      gestures={{
        onPointerMove: handlePointerMove,
        onPointerUp: handlePointerUp,
        onPointerCancel: abort,
      }}
    >
      {tables.map((table) => {
        const booking = reservationAt(byTable.get(table.id) ?? [], atMinutes);
        const status = deriveTableStatus({
          reservation: booking,
          nowMinutes,
          isBlocked: !table.isActive,
        });
        const seats =
          table.seatsMin === table.seatsMax
            ? `${table.seatsMin}`
            : `${table.seatsMin} to ${table.seatsMax}`;

        return (
          <ServiceTable
            key={table.id}
            table={table}
            status={status}
            booking={booking}
            seats={seats}
            unitsPerPx={view.unitsPerPx}
            selected={booking ? booking.id === selectedId : false}
            isDropTarget={dragging?.overTableId === table.id}
            onPointerDown={(e) => {
              e.stopPropagation();
              if (view.onPointerDown(e)) return;
              handlePointerDown(e, table.id);
            }}
          />
        );
      })}

      {dragging && (
        <circle
          className="sc-drag-ghost"
          cx={dragging.x}
          cy={dragging.y}
          r={18 * view.unitsPerPx}
        />
      )}
    </FloorCanvasShell>
  );
}

function ServiceTable({
  table,
  status,
  booking,
  seats,
  unitsPerPx,
  selected,
  isDropTarget,
  onPointerDown,
}: {
  table: {
    id: string;
    label: string;
    posX: number;
    posY: number;
    width: number;
    height: number;
    rotation: number;
    shape: string;
  };
  status: TableStatus;
  booking: Reservation | null;
  seats: string;
  unitsPerPx: number;
  selected: boolean;
  isDropTarget: boolean;
  onPointerDown: (e: ReactPointerEvent<SVGGElement>) => void;
}) {
  const cx = table.posX + table.width / 2;
  const cy = table.posY + table.height / 2;
  const hairline = unitsPerPx;
  const minTarget = 44 * unitsPerPx;
  const hitW = Math.max(table.width, minTarget);
  const hitH = Math.max(table.height, minTarget);
  const round = table.shape === "round" || table.shape === "high_top" || table.shape === "bar_stool";

  return (
    <g
      className={`sc-table sc-table-${status}${selected ? " is-selected" : ""}${
        isDropTarget ? " is-drop-target" : ""
      }`}
      transform={`rotate(${table.rotation} ${cx} ${cy})`}
      role="button"
      tabIndex={0}
      aria-label={serviceTableName(table.label, seats, status, booking)}
      onPointerDown={onPointerDown}
    >
      {round ? (
        <ellipse
          className="sc-table-body"
          cx={cx}
          cy={cy}
          rx={table.width / 2}
          ry={table.height / 2}
          strokeWidth={hairline * 1.5}
        />
      ) : (
        <rect
          className="sc-table-body"
          x={table.posX}
          y={table.posY}
          width={table.width}
          height={table.height}
          rx={6}
          strokeWidth={hairline * 1.5}
        />
      )}

      <rect
        x={cx - hitW / 2}
        y={cy - hitH / 2}
        width={hitW}
        height={hitH}
        fill="transparent"
      />

      <text
        className="sc-table-label fp-num"
        x={cx}
        y={booking ? cy - table.height * 0.14 : cy}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={Math.min(22, Math.max(13, table.height * 0.2))}
      >
        {table.label}
      </text>

      {booking && (
        <>
          <text
            className="sc-table-guest"
            x={cx}
            y={cy + table.height * 0.1}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={Math.min(13, Math.max(9, table.height * 0.12))}
          >
            {booking.guestName.split(" ")[0]}
          </text>
          <text
            className="sc-table-covers fp-num"
            x={cx}
            y={cy + table.height * 0.28}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={Math.min(12, Math.max(8, table.height * 0.11))}
          >
            {booking.partySize} · {booking.startTime}
          </text>
        </>
      )}

      {/* Shape, not just colour — the badge alone identifies the state. */}
      <StatusBadge
        status={status}
        x={table.posX + table.width - 12 * unitsPerPx}
        y={table.posY + 12 * unitsPerPx}
        size={9 * unitsPerPx}
      />

      {booking?.allergies?.trim() && (
        <text
          className="sc-table-allergy"
          x={cx}
          y={table.posY + table.height - 6 * unitsPerPx}
          textAnchor="middle"
          fontSize={Math.min(11, Math.max(8, table.height * 0.1))}
        >
          allergy
        </text>
      )}

      <title>{STATUS_META[status].label}</title>
    </g>
  );
}
