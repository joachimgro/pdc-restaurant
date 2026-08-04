"use client";

import { TABLE_SHAPES, type TableShape } from "@lead-intake/shared-types";
import { SHAPE_DEFAULTS } from "./geometry";
import { useFloorEditor } from "./store/floor-editor-store";

/**
 * Placement is pointer-driven rather than HTML5 drag-and-drop, which does not
 * fire on iPad. Pressing a shape arms it; releasing over the canvas places it.
 * That makes drag-to-place and tap-then-tap the same code path.
 */
export function ShapePalette() {
  const pendingShape = useFloorEditor((s) => s.pendingShape);
  const setPendingShape = useFloorEditor((s) => s.setPendingShape);
  const addTable = useFloorEditor((s) => s.addTable);
  const activeRoomId = useFloorEditor((s) => s.activeRoomId);
  const room = useFloorEditor((s) =>
    s.activeRoomId ? s.doc.rooms[s.activeRoomId] : null
  );

  if (!activeRoomId || !room) return null;

  return (
    <section className="fp-palette" aria-label="Table shapes">
      <h3 className="fp-panel-title">Add a table</h3>
      <p className="fp-panel-hint">
        Drag onto the plan, or tap a shape then tap where it goes.
      </p>
      <div className="fp-palette-grid">
        {TABLE_SHAPES.map((shape) => (
          <PaletteButton
            key={shape}
            shape={shape}
            armed={pendingShape === shape}
            onArm={() => setPendingShape(pendingShape === shape ? null : shape)}
            onPlaceCentre={() =>
              addTable(shape, room.canvasWidth / 2, room.canvasHeight / 2)
            }
          />
        ))}
      </div>
    </section>
  );
}

function PaletteButton({
  shape,
  armed,
  onArm,
  onPlaceCentre,
}: {
  shape: TableShape;
  armed: boolean;
  onArm: () => void;
  onPlaceCentre: () => void;
}) {
  const defaults = SHAPE_DEFAULTS[shape];

  return (
    <button
      type="button"
      className={`fp-palette-item${armed ? " is-armed" : ""}`}
      aria-pressed={armed}
      aria-label={`${defaults.label}, seats ${defaults.seatsMin} to ${defaults.seatsMax}`}
      onPointerDown={onArm}
      onKeyDown={(e) => {
        // Keyboard users get a definite placement rather than a drag.
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onPlaceCentre();
        }
      }}
    >
      <span className="fp-palette-glyph" aria-hidden="true">
        <PaletteGlyph shape={shape} />
      </span>
      <span className="fp-palette-label">{defaults.label}</span>
      <span className="fp-palette-seats">
        {defaults.seatsMin === defaults.seatsMax
          ? defaults.seatsMin
          : `${defaults.seatsMin}–${defaults.seatsMax}`}
      </span>
    </button>
  );
}

function PaletteGlyph({ shape }: { shape: TableShape }) {
  const props = {
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.5,
  };
  switch (shape) {
    case "round":
    case "high_top":
      return (
        <svg width="28" height="28" viewBox="0 0 28 28">
          <circle {...props} cx="14" cy="14" r="9" />
        </svg>
      );
    case "bar_stool":
      return (
        <svg width="28" height="28" viewBox="0 0 28 28">
          <circle {...props} cx="14" cy="14" r="5.5" />
        </svg>
      );
    case "rect":
      return (
        <svg width="28" height="28" viewBox="0 0 28 28">
          <rect {...props} x="3" y="9" width="22" height="10" rx="2" />
        </svg>
      );
    case "sofa":
      return (
        <svg width="28" height="28" viewBox="0 0 28 28">
          <rect {...props} x="4" y="9" width="20" height="11" rx="3" />
          <path {...props} d="M7 13h14" />
        </svg>
      );
    case "booth":
    case "banquette":
      return (
        <svg width="28" height="28" viewBox="0 0 28 28">
          <path
            {...props}
            d="M5 8h18v8a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3V8Z"
          />
        </svg>
      );
    case "square":
    default:
      return (
        <svg width="28" height="28" viewBox="0 0 28 28">
          <rect {...props} x="6" y="6" width="16" height="16" rx="2" />
        </svg>
      );
  }
}
