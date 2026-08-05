"use client";

import {
  useCallback,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  clamp,
  clampToCanvas,
  distance,
  marqueeRect,
  rectsIntersect,
  snap,
  snapRotation,
  tableRect,
  type Rect,
} from "../geometry";
import { combosForTable, tablesInRoom } from "../normalise";
import { TableShape } from "../TableShape";
import { useFloorEditor } from "../store/floor-editor-store";
import type { EditorTable, RoomMeta } from "../types";
import { FloorCanvasShell } from "./FloorCanvasShell";
import { useCanvasViewport } from "./useCanvasViewport";

/**
 * Layout mode: build the room. Moved out of the old FloorCanvas unchanged —
 * multi-touch now lives in useCanvasViewport, and everything below is what a
 * single pointer means while editing.
 */

/** Movement before a press becomes a drag, in CSS px. */
const DRAG_THRESHOLD_PX = 4;
/** Press duration that opens context actions, in ms. */
const LONG_PRESS_MS = 500;
const MIN_TABLE_UNITS = 20;

type Corner = "nw" | "ne" | "se" | "sw";

type Gesture =
  | { kind: "none" }
  | {
      kind: "pending";
      pointerId: number;
      tableId: string | null;
      startClient: { x: number; y: number };
      startCanvas: { x: number; y: number };
      additive: boolean;
    }
  | {
      kind: "drag";
      pointerId: number;
      startCanvas: { x: number; y: number };
      origin: Record<string, { posX: number; posY: number }>;
    }
  | {
      kind: "marquee";
      pointerId: number;
      startCanvas: { x: number; y: number };
      additive: boolean;
      base: string[];
    }
  | {
      kind: "resize";
      pointerId: number;
      tableId: string;
      corner: Corner;
      start: EditorTable;
    }
  | {
      kind: "rotate";
      pointerId: number;
      tableId: string;
      centre: { x: number; y: number };
    };

export function LayoutCanvas({
  room,
  onLongPress,
}: {
  room: RoomMeta;
  onLongPress: (tableId: string, clientX: number, clientY: number) => void;
}) {
  const gestureRef = useRef<Gesture>({ kind: "none" });
  const longPressRef = useRef<number | null>(null);
  const [marquee, setMarquee] = useState<Rect | null>(null);

  const doc = useFloorEditor((s) => s.doc);
  const selection = useFloorEditor((s) => s.selection);
  const setSelection = useFloorEditor((s) => s.setSelection);
  const toggleSelected = useFloorEditor((s) => s.toggleSelected);
  const beginInteraction = useFloorEditor((s) => s.beginInteraction);
  const applyTransient = useFloorEditor((s) => s.applyTransient);
  const commitInteraction = useFloorEditor((s) => s.commitInteraction);
  const cancelInteraction = useFloorEditor((s) => s.cancelInteraction);

  const clearLongPress = useCallback(() => {
    if (longPressRef.current !== null) {
      window.clearTimeout(longPressRef.current);
      longPressRef.current = null;
    }
  }, []);

  /**
   * Abandon any in-flight single-pointer gesture without recording history.
   *
   * A second finger landing means the user is zooming, not dragging — and the
   * half-finished move must leave no trace, or every pinch nudges a table.
   */
  const abortSinglePointerGesture = useCallback(() => {
    const gesture = gestureRef.current;
    if (
      gesture.kind === "drag" ||
      gesture.kind === "resize" ||
      gesture.kind === "rotate"
    ) {
      cancelInteraction();
    }
    gestureRef.current = { kind: "none" };
    setMarquee(null);
    clearLongPress();
  }, [cancelInteraction, clearLongPress]);

  const view = useCanvasViewport({
    room,
    onMultiTouchStart: abortSinglePointerGesture,
  });

  const tables = tablesInRoom(doc, room.id);

  const handlePointerDown = useCallback(
    (e: ReactPointerEvent<SVGElement>, tableId: string | null) => {
      const state = useFloorEditor.getState();

      // Palette placement: a shape armed by tap or dragged over the canvas is
      // placed on pointerup, so the press itself does nothing here.
      if (state.pendingShape) return;

      const startCanvas = view.toCanvas(e.clientX, e.clientY);
      if (!startCanvas) return;

      const additive = e.shiftKey || e.metaKey || e.ctrlKey;
      gestureRef.current = {
        kind: "pending",
        pointerId: e.pointerId,
        tableId,
        startClient: { x: e.clientX, y: e.clientY },
        startCanvas,
        additive,
      };

      if (tableId) {
        clearLongPress();
        longPressRef.current = window.setTimeout(() => {
          // Still a press, not a drag — offer context actions.
          if (gestureRef.current.kind === "pending") {
            gestureRef.current = { kind: "none" };
            view.releasePointer(e.pointerId);
            onLongPress(tableId, e.clientX, e.clientY);
          }
        }, LONG_PRESS_MS);
      }
    },
    [clearLongPress, onLongPress, view]
  );

  const handlePointerMove = useCallback(
    (e: ReactPointerEvent<SVGElement>) => {
      const gesture = gestureRef.current;
      const current = view.toCanvas(e.clientX, e.clientY);
      if (!current) return;

      if (gesture.kind === "pending") {
        const moved = distance(gesture.startClient, {
          x: e.clientX,
          y: e.clientY,
        });
        if (moved < DRAG_THRESHOLD_PX) return;
        clearLongPress();

        if (gesture.tableId) {
          const state = useFloorEditor.getState();
          const ids = state.selection.includes(gesture.tableId)
            ? state.selection
            : [gesture.tableId];
          if (!state.selection.includes(gesture.tableId)) setSelection(ids);

          const origin: Record<string, { posX: number; posY: number }> = {};
          for (const id of ids) {
            const t = state.doc.tables[id];
            if (t) origin[id] = { posX: t.posX, posY: t.posY };
          }
          beginInteraction({ roomId: room.id, tableIds: ids });
          gestureRef.current = {
            kind: "drag",
            pointerId: gesture.pointerId,
            startCanvas: gesture.startCanvas,
            origin,
          };
        } else {
          gestureRef.current = {
            kind: "marquee",
            pointerId: gesture.pointerId,
            startCanvas: gesture.startCanvas,
            additive: gesture.additive,
            base: gesture.additive ? useFloorEditor.getState().selection : [],
          };
        }
        return;
      }

      if (gesture.kind === "drag") {
        const dx = snap(current.x - gesture.startCanvas.x);
        const dy = snap(current.y - gesture.startCanvas.y);
        applyTransient((d) => {
          const next = { ...d.tables };
          for (const [id, origin] of Object.entries(gesture.origin)) {
            const t = next[id];
            if (!t) continue;
            const moved = clampToCanvas(
              { ...t, posX: origin.posX + dx, posY: origin.posY + dy },
              room
            );
            if (moved.posX === t.posX && moved.posY === t.posY) continue;
            next[id] = { ...t, ...moved };
          }
          return { ...d, tables: next };
        });
        return;
      }

      if (gesture.kind === "marquee") {
        const rect = marqueeRect(
          gesture.startCanvas.x,
          gesture.startCanvas.y,
          current.x,
          current.y
        );
        setMarquee(rect);
        const hits = tables
          .filter((t) => rectsIntersect(tableRect(t), rect))
          .map((t) => t.id);
        setSelection(
          gesture.additive ? [...new Set([...gesture.base, ...hits])] : hits
        );
        return;
      }

      if (gesture.kind === "resize") {
        const start = gesture.start;
        applyTransient((d) => {
          const t = d.tables[gesture.tableId];
          if (!t) return d;
          const next = resizeFromCorner(start, gesture.corner, current, room);
          return {
            ...d,
            tables: { ...d.tables, [gesture.tableId]: { ...t, ...next } },
          };
        });
        return;
      }

      if (gesture.kind === "rotate") {
        const angle =
          (Math.atan2(
            current.y - gesture.centre.y,
            current.x - gesture.centre.x
          ) *
            180) /
            Math.PI +
          90;
        applyTransient((d) => {
          const t = d.tables[gesture.tableId];
          if (!t) return d;
          const rotation = snapRotation(angle);
          if (rotation === t.rotation) return d;
          return {
            ...d,
            tables: { ...d.tables, [gesture.tableId]: { ...t, rotation } },
          };
        });
      }
    },
    [applyTransient, beginInteraction, clearLongPress, room, setSelection, tables, view]
  );

  const handlePointerUp = useCallback(
    (e: ReactPointerEvent<SVGElement>) => {
      const state = useFloorEditor.getState();
      const gesture = gestureRef.current;
      clearLongPress();

      // Placing a table from the palette: the pointer went down on the palette
      // and came up here, so no canvas gesture ever started.
      if (state.pendingShape) {
        const point = view.toCanvas(e.clientX, e.clientY);
        if (point) {
          state.addTable(state.pendingShape, point.x, point.y);
          state.setPendingShape(null);
        }
        gestureRef.current = { kind: "none" };
        return;
      }

      if (gesture.kind === "pending") {
        // A tap: select, or toggle when additive.
        if (gesture.tableId) {
          if (gesture.additive) toggleSelected(gesture.tableId);
          else setSelection([gesture.tableId]);
        } else if (!gesture.additive) {
          setSelection([]);
        }
      }

      if (
        gesture.kind === "drag" ||
        gesture.kind === "resize" ||
        gesture.kind === "rotate"
      ) {
        commitInteraction();
      }

      setMarquee(null);
      gestureRef.current = { kind: "none" };
    },
    [clearLongPress, commitInteraction, setSelection, toggleSelected, view]
  );

  const startHandleGesture = useCallback(
    (e: ReactPointerEvent<SVGElement>, gesture: Gesture) => {
      e.stopPropagation();
      if (view.trackPointer(e) > 1) {
        abortSinglePointerGesture();
        return;
      }
      beginInteraction({
        roomId: room.id,
        tableIds: useFloorEditor.getState().selection,
      });
      gestureRef.current = gesture;
    },
    [abortSinglePointerGesture, beginInteraction, room.id, view]
  );

  const single = selection.length === 1 ? doc.tables[selection[0]] : undefined;

  return (
    <FloorCanvasShell
      room={room}
      view={view}
      showGrid
      ariaLabel={`${room.name} floor plan, ${tables.length} tables`}
      gestures={{
        onPointerDown: (e) => handlePointerDown(e, null),
        onPointerMove: handlePointerMove,
        onPointerUp: handlePointerUp,
        onPointerCancel: abortSinglePointerGesture,
      }}
    >
      {tables.map((table) => (
        <TableShape
          key={table.id}
          table={table}
          selected={selection.includes(table.id)}
          unitsPerPx={view.unitsPerPx}
          comboLabels={combosForTable(doc, table.id).map((c) => c.label)}
          onPointerDown={(e, id) => {
            e.stopPropagation();
            if (view.onPointerDown(e)) return;
            handlePointerDown(e, id);
          }}
        />
      ))}

      {single && (
        <SelectionHandles
          table={single}
          unitsPerPx={view.unitsPerPx}
          onResizeStart={(e, corner) =>
            startHandleGesture(e, {
              kind: "resize",
              pointerId: e.pointerId,
              tableId: single.id,
              corner,
              start: single,
            })
          }
          onRotateStart={(e) =>
            startHandleGesture(e, {
              kind: "rotate",
              pointerId: e.pointerId,
              tableId: single.id,
              centre: {
                x: single.posX + single.width / 2,
                y: single.posY + single.height / 2,
              },
            })
          }
        />
      )}

      {marquee && (
        <rect
          className="fp-marquee"
          x={marquee.x}
          y={marquee.y}
          width={marquee.width}
          height={marquee.height}
        />
      )}
    </FloorCanvasShell>
  );
}

function SelectionHandles({
  table,
  unitsPerPx,
  onResizeStart,
  onRotateStart,
}: {
  table: EditorTable;
  unitsPerPx: number;
  onResizeStart: (e: ReactPointerEvent<SVGElement>, corner: Corner) => void;
  onRotateStart: (e: ReactPointerEvent<SVGElement>) => void;
}) {
  const r = 7 * unitsPerPx;
  const hit = 22 * unitsPerPx; // 44px target
  const cx = table.posX + table.width / 2;
  const cy = table.posY + table.height / 2;
  const rotateY = table.posY - 34 * unitsPerPx;

  const corners: { corner: Corner; x: number; y: number }[] = [
    { corner: "nw", x: table.posX, y: table.posY },
    { corner: "ne", x: table.posX + table.width, y: table.posY },
    { corner: "se", x: table.posX + table.width, y: table.posY + table.height },
    { corner: "sw", x: table.posX, y: table.posY + table.height },
  ];

  return (
    <g transform={`rotate(${table.rotation} ${cx} ${cy})`}>
      <line
        className="fp-rotate-stem"
        x1={cx}
        y1={table.posY}
        x2={cx}
        y2={rotateY}
        strokeWidth={unitsPerPx}
      />
      <circle
        className="fp-handle fp-handle-rotate"
        cx={cx}
        cy={rotateY}
        r={r}
        strokeWidth={unitsPerPx * 1.5}
        role="button"
        tabIndex={-1}
        aria-label={`Rotate table ${table.label}`}
        onPointerDown={onRotateStart}
      />
      <circle
        cx={cx}
        cy={rotateY}
        r={hit}
        fill="transparent"
        onPointerDown={onRotateStart}
      />

      {corners.map(({ corner, x, y }) => (
        <g key={corner}>
          <rect
            className="fp-handle"
            x={x - r}
            y={y - r}
            width={r * 2}
            height={r * 2}
            rx={r * 0.4}
            strokeWidth={unitsPerPx * 1.5}
            role="button"
            tabIndex={-1}
            aria-label={`Resize table ${table.label}`}
            onPointerDown={(e) => onResizeStart(e, corner)}
          />
          <rect
            x={x - hit}
            y={y - hit}
            width={hit * 2}
            height={hit * 2}
            fill="transparent"
            onPointerDown={(e) => onResizeStart(e, corner)}
          />
        </g>
      ))}
    </g>
  );
}

/** New geometry for a corner drag, snapped, clamped, and never inverted. */
function resizeFromCorner(
  start: EditorTable,
  corner: Corner,
  pointer: { x: number; y: number },
  room: Pick<RoomMeta, "canvasWidth" | "canvasHeight">
): { posX: number; posY: number; width: number; height: number } {
  const right = start.posX + start.width;
  const bottom = start.posY + start.height;
  const px = snap(clamp(pointer.x, 0, room.canvasWidth));
  const py = snap(clamp(pointer.y, 0, room.canvasHeight));

  let posX = start.posX;
  let posY = start.posY;
  let width = start.width;
  let height = start.height;

  if (corner === "nw" || corner === "sw") {
    posX = Math.min(px, right - MIN_TABLE_UNITS);
    width = right - posX;
  } else {
    width = Math.max(MIN_TABLE_UNITS, px - start.posX);
  }

  if (corner === "nw" || corner === "ne") {
    posY = Math.min(py, bottom - MIN_TABLE_UNITS);
    height = bottom - posY;
  } else {
    height = Math.max(MIN_TABLE_UNITS, py - start.posY);
  }

  const clamped = clampToCanvas({ posX, posY, width, height }, room);
  return {
    posX: clamped.posX,
    posY: clamped.posY,
    width: Math.min(width, room.canvasWidth - clamped.posX),
    height: Math.min(height, room.canvasHeight - clamped.posY),
  };
}
