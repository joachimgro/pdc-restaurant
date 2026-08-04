import { FLOOR_GRID_UNITS } from "@lead-intake/shared-types";
import type { EditorTable, RoomMeta, TableShape } from "./types";

/** Rotation step in degrees. The spec fixes this at 15. */
export const ROTATION_STEP = 15;

/** Nudge distances, in canvas units. */
export const NUDGE_SMALL = FLOOR_GRID_UNITS;
export const NUDGE_LARGE = FLOOR_GRID_UNITS * 10;

export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 4;

/** Stable default — never allocate inline inside a Zustand selector. */
export const DEFAULT_VIEWPORT = { zoom: 1, panX: 0, panY: 0 } as const;

/**
 * Defaults per shape, in canvas units, matched to the seeded demo venue so a
 * hand-built room lands on the same proportions as the seed.
 */
export const SHAPE_DEFAULTS: Record<
  TableShape,
  { width: number; height: number; seatsMin: number; seatsMax: number; label: string }
> = {
  round: { width: 100, height: 100, seatsMin: 2, seatsMax: 4, label: "Round" },
  square: { width: 110, height: 110, seatsMin: 4, seatsMax: 4, label: "Square" },
  rect: { width: 200, height: 110, seatsMin: 6, seatsMax: 8, label: "Rectangle" },
  booth: { width: 140, height: 100, seatsMin: 4, seatsMax: 6, label: "Booth" },
  banquette: { width: 100, height: 70, seatsMin: 2, seatsMax: 2, label: "Banquette" },
  bar_stool: { width: 60, height: 60, seatsMin: 1, seatsMax: 2, label: "Bar stool" },
  high_top: { width: 100, height: 100, seatsMin: 2, seatsMax: 4, label: "High top" },
  sofa: { width: 180, height: 90, seatsMin: 4, seatsMax: 6, label: "Sofa" },
};

export function snap(value: number): number {
  return Math.round(value / FLOOR_GRID_UNITS) * FLOOR_GRID_UNITS;
}

export function snapRotation(deg: number): number {
  const stepped = Math.round(deg / ROTATION_STEP) * ROTATION_STEP;
  // The schema allows 0-359, so 360 must wrap rather than fail validation.
  return ((stepped % 360) + 360) % 360;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Keep a table wholly on the canvas. The server rejects a table that extends
 * past the edge, so the editor never lets one get there in the first place —
 * but it clamps during a drag only, never silently on load, because a table
 * that moves on its own is reported as "it moved my table".
 */
export function clampToCanvas(
  table: Pick<EditorTable, "posX" | "posY" | "width" | "height">,
  room: Pick<RoomMeta, "canvasWidth" | "canvasHeight">
): { posX: number; posY: number } {
  return {
    posX: clamp(table.posX, 0, Math.max(0, room.canvasWidth - table.width)),
    posY: clamp(table.posY, 0, Math.max(0, room.canvasHeight - table.height)),
  };
}

export type Rect = { x: number; y: number; width: number; height: number };

export function tableRect(table: EditorTable): Rect {
  return {
    x: table.posX,
    y: table.posY,
    width: table.width,
    height: table.height,
  };
}

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

/** Normalised marquee rect from two corner points, in canvas units. */
export function marqueeRect(
  ax: number,
  ay: number,
  bx: number,
  by: number
): Rect {
  return {
    x: Math.min(ax, bx),
    y: Math.min(ay, by),
    width: Math.abs(ax - bx),
    height: Math.abs(ay - by),
  };
}

export function boundingBox(tables: EditorTable[]): Rect | null {
  if (tables.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const t of tables) {
    minX = Math.min(minX, t.posX);
    minY = Math.min(minY, t.posY);
    maxX = Math.max(maxX, t.posX + t.width);
    maxY = Math.max(maxY, t.posY + t.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export type AlignMode =
  | "left"
  | "right"
  | "top"
  | "bottom"
  | "centre-x"
  | "centre-y";

/** New positions for an align operation, keyed by table id. */
export function alignTables(
  tables: EditorTable[],
  mode: AlignMode
): Record<string, { posX: number; posY: number }> {
  const box = boundingBox(tables);
  const out: Record<string, { posX: number; posY: number }> = {};
  if (!box || tables.length < 2) return out;

  for (const t of tables) {
    let { posX, posY } = t;
    switch (mode) {
      case "left":
        posX = box.x;
        break;
      case "right":
        posX = box.x + box.width - t.width;
        break;
      case "top":
        posY = box.y;
        break;
      case "bottom":
        posY = box.y + box.height - t.height;
        break;
      case "centre-x":
        posX = box.x + (box.width - t.width) / 2;
        break;
      case "centre-y":
        posY = box.y + (box.height - t.height) / 2;
        break;
    }
    out[t.id] = { posX: snap(posX), posY: snap(posY) };
  }
  return out;
}

/**
 * Even gaps between tables along an axis, outer two held in place. Needs three
 * tables to mean anything — with two there is no interior gap to distribute.
 */
export function distributeTables(
  tables: EditorTable[],
  axis: "x" | "y"
): Record<string, { posX: number; posY: number }> {
  const out: Record<string, { posX: number; posY: number }> = {};
  if (tables.length < 3) return out;

  const sorted = [...tables].sort((a, b) =>
    axis === "x" ? a.posX - b.posX : a.posY - b.posY
  );
  const first = sorted[0];
  const last = sorted[sorted.length - 1];

  const span =
    axis === "x"
      ? last.posX + last.width - first.posX
      : last.posY + last.height - first.posY;
  const totalSize = sorted.reduce(
    (sum, t) => sum + (axis === "x" ? t.width : t.height),
    0
  );
  const gap = (span - totalSize) / (sorted.length - 1);

  let cursor = axis === "x" ? first.posX : first.posY;
  for (const t of sorted) {
    out[t.id] =
      axis === "x"
        ? { posX: snap(cursor), posY: t.posY }
        : { posX: t.posX, posY: snap(cursor) };
    cursor += (axis === "x" ? t.width : t.height) + gap;
  }
  return out;
}

/**
 * Pointer position in canvas units.
 *
 * Read off the rendered element's own screen matrix rather than computed from
 * zoom and pan by hand, so fit-to-viewBox scaling, zoom and pan compose
 * correctly without the editor tracking any of them.
 */
export function clientToCanvas(
  el: SVGGraphicsElement,
  clientX: number,
  clientY: number
): { x: number; y: number } | null {
  const ctm = el.getScreenCTM();
  if (!ctm) return null;
  const inverse = ctm.inverse();
  const svg = el.ownerSVGElement ?? (el as unknown as SVGSVGElement);
  const point = svg.createSVGPoint();
  point.x = clientX;
  point.y = clientY;
  const mapped = point.matrixTransform(inverse);
  return { x: mapped.x, y: mapped.y };
}

export function distance(
  a: { x: number; y: number },
  b: { x: number; y: number }
): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function midpoint(
  a: { x: number; y: number },
  b: { x: number; y: number }
): { x: number; y: number } {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}
