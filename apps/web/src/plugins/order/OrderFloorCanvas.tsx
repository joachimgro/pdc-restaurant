"use client";

import { useMemo, type PointerEvent as ReactPointerEvent } from "react";
import type { DiningTable, Room } from "@lead-intake/shared-types";
import { FloorCanvasShell } from "@/plugins/service/canvas/FloorCanvasShell";
import { useCanvasViewport } from "@/plugins/service/canvas/useCanvasViewport";
import type { RoomMeta } from "@/plugins/service/types";

type OpenInfo = { count: number };

/**
 * Spatial table picker for order-taking — same canvas geometry as Floor view,
 * without reservation chips or drag-reassign.
 */
export function OrderFloorCanvas({
  room,
  openByTable,
  onSelect,
}: {
  room: Room;
  openByTable: Map<string, OpenInfo>;
  onSelect: (label: string) => void;
}) {
  const roomMeta: RoomMeta = useMemo(
    () => ({
      id: room.id,
      name: room.name,
      accentColor: room.accentColor,
      onlineBookable: room.onlineBookable,
      canvasWidth: room.canvasWidth,
      canvasHeight: room.canvasHeight,
      sortOrder: room.sortOrder,
      isActive: room.isActive,
    }),
    [room]
  );

  const view = useCanvasViewport({
    room: roomMeta,
    onMultiTouchStart: () => {},
  });

  const tables = room.tables.filter((t) => t.isActive);

  return (
    <FloorCanvasShell
      room={roomMeta}
      view={view}
      ariaLabel={`${room.name} floor plan — tap a table to order`}
      className="od-floor-canvas"
      gestures={{}}
    >
      {tables.map((table) => (
        <OrderTable
          key={table.id}
          table={table}
          openCount={openByTable.get(table.label)?.count ?? 0}
          unitsPerPx={view.unitsPerPx}
          onSelect={onSelect}
        />
      ))}
    </FloorCanvasShell>
  );
}

function OrderTable({
  table,
  openCount,
  unitsPerPx,
  onSelect,
}: {
  table: DiningTable;
  openCount: number;
  unitsPerPx: number;
  onSelect: (label: string) => void;
}) {
  const cx = table.posX + table.width / 2;
  const cy = table.posY + table.height / 2;
  const hairline = unitsPerPx;
  const minTarget = 44 * unitsPerPx;
  const hitW = Math.max(table.width, minTarget);
  const hitH = Math.max(table.height, minTarget);
  const round =
    table.shape === "round" ||
    table.shape === "high_top" ||
    table.shape === "bar_stool";
  const busy = openCount > 0;

  const onPointerUp = (e: ReactPointerEvent<SVGGElement>) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    e.stopPropagation();
    onSelect(table.label);
  };

  return (
    <g
      className={`od-floor-table${busy ? " is-busy" : ""}`}
      transform={`rotate(${table.rotation} ${cx} ${cy})`}
      role="button"
      tabIndex={0}
      aria-label={
        busy
          ? `Table ${table.label}, ${openCount} open ticket${openCount === 1 ? "" : "s"}`
          : `Table ${table.label}`
      }
      onPointerUp={onPointerUp}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(table.label);
        }
      }}
    >
      {round ? (
        <ellipse
          className="od-floor-table-body"
          cx={cx}
          cy={cy}
          rx={table.width / 2}
          ry={table.height / 2}
          strokeWidth={hairline * 1.5}
        />
      ) : (
        <rect
          className="od-floor-table-body"
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
        className="od-floor-table-label"
        x={cx}
        y={busy ? cy - table.height * 0.12 : cy}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={Math.min(22, Math.max(13, table.height * 0.2))}
      >
        {table.label}
      </text>

      {busy && (
        <text
          className="od-floor-table-count"
          x={cx}
          y={cy + table.height * 0.22}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={Math.min(16, Math.max(11, table.height * 0.14))}
        >
          {openCount}
        </text>
      )}
    </g>
  );
}
