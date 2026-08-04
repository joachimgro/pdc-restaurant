"use client";

import type { PointerEvent as ReactPointerEvent } from "react";
import type { EditorTable } from "./types";

/** Minimum touch target, per the spec's 44px floor. */
const MIN_TARGET_PX = 44;

export type TableShapeProps = {
  table: EditorTable;
  selected: boolean;
  /** Canvas units per CSS pixel — used to keep touch targets 44px on screen. */
  unitsPerPx: number;
  /** Labels of combinations this table belongs to. */
  comboLabels: string[];
  onPointerDown: (e: ReactPointerEvent<SVGGElement>, tableId: string) => void;
};

/**
 * The accessible name carries everything colour or shape is doing visually.
 * A screen reader user gets the same information a sighted one does.
 */
export function tableAccessibleName(
  table: EditorTable,
  comboLabels: string[]
): string {
  const parts = [
    `Table ${table.label}`,
    shapeWord(table.shape),
    table.seatsMin === table.seatsMax
      ? `seats ${table.seatsMin}`
      : `seats ${table.seatsMin} to ${table.seatsMax}`,
    table.onlineBookable ? "bookable online" : "not bookable online",
  ];
  if (!table.isActive) parts.push("out of service");
  if (table.rotation !== 0) parts.push(`rotated ${table.rotation} degrees`);
  if (comboLabels.length > 0) {
    parts.push(`in combination ${comboLabels.join(", ")}`);
  }
  return parts.join(", ");
}

function shapeWord(shape: EditorTable["shape"]): string {
  return shape.replace(/_/g, " ");
}

export function TableShape({
  table,
  selected,
  unitsPerPx,
  comboLabels,
  onPointerDown,
}: TableShapeProps) {
  const { posX, posY, width, height, rotation } = table;
  const cx = posX + width / 2;
  const cy = posY + height / 2;

  // Hit area never smaller than 44 CSS px, whatever the zoom.
  const minUnits = MIN_TARGET_PX * unitsPerPx;
  const hitW = Math.max(width, minUnits);
  const hitH = Math.max(height, minUnits);

  const hairline = unitsPerPx; // 1 CSS px, expressed in canvas units

  return (
    <g
      className={`fp-table${selected ? " is-selected" : ""}${
        table.isActive ? "" : " is-inactive"
      }`}
      transform={`rotate(${rotation} ${cx} ${cy})`}
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      aria-label={tableAccessibleName(table, comboLabels)}
      data-table-id={table.id}
      onPointerDown={(e) => onPointerDown(e, table.id)}
    >
      <ShapeBody table={table} strokeWidth={hairline * 1.5} />

      {/* Transparent target that guarantees the 44px floor without changing
          the drawn size of the table. */}
      <rect
        className="fp-table-hit"
        x={cx - hitW / 2}
        y={cy - hitH / 2}
        width={hitW}
        height={hitH}
        fill="transparent"
      />

      <text
        className="fp-table-label"
        x={cx}
        y={cy}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={Math.min(22, Math.max(13, height * 0.22))}
      >
        {table.label}
      </text>

      <text
        className="fp-table-seats"
        x={cx}
        y={cy + Math.min(22, Math.max(13, height * 0.22)) * 0.95}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={Math.min(14, Math.max(9, height * 0.14))}
      >
        {table.seatsMin === table.seatsMax
          ? table.seatsMin
          : `${table.seatsMin}–${table.seatsMax}`}
      </text>

      {/* Status as text, never colour alone. */}
      {!table.onlineBookable && (
        <text
          className="fp-table-flag"
          x={cx}
          y={posY + height - Math.max(8, height * 0.1)}
          textAnchor="middle"
          fontSize={Math.min(12, Math.max(8, height * 0.12))}
        >
          offline
        </text>
      )}

      {selected && (
        <rect
          className="fp-table-focus"
          x={posX - hairline * 3}
          y={posY - hairline * 3}
          width={width + hairline * 6}
          height={height + hairline * 6}
          rx={6}
          fill="none"
          strokeWidth={hairline * 2}
        />
      )}
    </g>
  );
}

function ShapeBody({
  table,
  strokeWidth,
}: {
  table: EditorTable;
  strokeWidth: number;
}) {
  const { posX, posY, width, height, shape } = table;
  const common = {
    className: "fp-table-body",
    strokeWidth,
  };

  switch (shape) {
    case "round":
    case "high_top":
      return (
        <ellipse
          {...common}
          cx={posX + width / 2}
          cy={posY + height / 2}
          rx={width / 2}
          ry={height / 2}
        />
      );
    case "bar_stool":
      return (
        <ellipse
          {...common}
          className="fp-table-body fp-shape-stool"
          cx={posX + width / 2}
          cy={posY + height / 2}
          rx={width / 2}
          ry={height / 2}
        />
      );
    case "booth":
    case "banquette":
      // Flat back edge, rounded front — reads as seating against a wall.
      return (
        <path
          {...common}
          d={`M ${posX} ${posY}
              H ${posX + width}
              V ${posY + height - Math.min(18, height / 3)}
              Q ${posX + width} ${posY + height} ${
                posX + width - Math.min(18, height / 3)
              } ${posY + height}
              H ${posX + Math.min(18, height / 3)}
              Q ${posX} ${posY + height} ${posX} ${
                posY + height - Math.min(18, height / 3)
              }
              Z`}
        />
      );
    case "sofa":
      return (
        <g>
          <rect
            {...common}
            x={posX}
            y={posY}
            width={width}
            height={height}
            rx={Math.min(14, height / 3)}
          />
          <path
            className="fp-table-detail"
            strokeWidth={strokeWidth}
            fill="none"
            d={`M ${posX + 6} ${posY + height * 0.32} H ${posX + width - 6}`}
          />
        </g>
      );
    case "rect":
    case "square":
    default:
      return (
        <rect
          {...common}
          x={posX}
          y={posY}
          width={width}
          height={height}
          rx={6}
        />
      );
  }
}
