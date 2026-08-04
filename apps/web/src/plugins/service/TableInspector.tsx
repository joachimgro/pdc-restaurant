"use client";

import { TABLE_SHAPES } from "@lead-intake/shared-types";
import { SHAPE_DEFAULTS } from "./geometry";
import { combosForTable } from "./normalise";
import { useFloorEditor } from "./store/floor-editor-store";

/** Right panel for the selected table. */
export function TableInspector() {
  const selection = useFloorEditor((s) => s.selection);
  const doc = useFloorEditor((s) => s.doc);
  const highlight = useFloorEditor((s) => s.highlight);
  const updateTable = useFloorEditor((s) => s.updateTable);

  if (selection.length === 0) {
    return (
      <section className="fp-inspector" aria-label="Table details">
        <p className="fp-panel-hint">
          Select a table to edit it. Drag on empty floor to select several.
        </p>
      </section>
    );
  }

  if (selection.length > 1) {
    return (
      <section className="fp-inspector" aria-label="Table details">
        <h3 className="fp-panel-title">{selection.length} tables selected</h3>
        <p className="fp-panel-hint">
          Use align and distribute in the toolbar, or join them as a
          combination.
        </p>
        <ul className="fp-multi-list">
          {selection.map((id) => {
            const t = doc.tables[id];
            return t ? (
              <li key={id} className="fp-multi-item">
                <span className="fp-num">{t.label}</span>
                <span className="fp-multi-seats">
                  {t.seatsMin}–{t.seatsMax}
                </span>
              </li>
            ) : null;
          })}
        </ul>
      </section>
    );
  }

  const table = doc.tables[selection[0]];
  if (!table) return null;

  const fieldClass = (field: string) =>
    `fp-field${highlight?.field === field && highlight.tableId === table.id ? " is-flagged" : ""}`;

  const combos = combosForTable(doc, table.id);

  return (
    <section className="fp-inspector" aria-label={`Table ${table.label} details`}>
      <h3 className="fp-panel-title">Table {table.label}</h3>

      <div className={fieldClass("label")}>
        <label htmlFor="fp-label">Label</label>
        <input
          id="fp-label"
          className="fp-input fp-num"
          value={table.label}
          maxLength={16}
          onChange={(e) => updateTable(table.id, { label: e.target.value })}
        />
      </div>

      <div className="fp-field-row">
        <div className={fieldClass("seatsMin")}>
          <label htmlFor="fp-seats-min">Seats min</label>
          <input
            id="fp-seats-min"
            className="fp-input fp-num"
            type="number"
            min={1}
            max={100}
            value={table.seatsMin}
            onChange={(e) =>
              updateTable(table.id, { seatsMin: toInt(e.target.value, 1) })
            }
          />
        </div>
        <div className={fieldClass("seatsMax")}>
          <label htmlFor="fp-seats-max">Seats max</label>
          <input
            id="fp-seats-max"
            className="fp-input fp-num"
            type="number"
            min={1}
            max={100}
            value={table.seatsMax}
            onChange={(e) =>
              updateTable(table.id, { seatsMax: toInt(e.target.value, 1) })
            }
          />
        </div>
      </div>

      <div className={fieldClass("shape")}>
        <label htmlFor="fp-shape">Shape</label>
        <select
          id="fp-shape"
          className="fp-input"
          value={table.shape}
          onChange={(e) =>
            updateTable(table.id, {
              shape: e.target.value as (typeof TABLE_SHAPES)[number],
            })
          }
        >
          {TABLE_SHAPES.map((shape) => (
            <option key={shape} value={shape}>
              {SHAPE_DEFAULTS[shape].label}
            </option>
          ))}
        </select>
      </div>

      <div className="fp-field-row">
        <div className={fieldClass("width")}>
          <label htmlFor="fp-width">Width</label>
          <input
            id="fp-width"
            className="fp-input fp-num"
            type="number"
            min={20}
            step={10}
            value={table.width}
            onChange={(e) =>
              updateTable(table.id, { width: toInt(e.target.value, 20) })
            }
          />
        </div>
        <div className={fieldClass("height")}>
          <label htmlFor="fp-height">Height</label>
          <input
            id="fp-height"
            className="fp-input fp-num"
            type="number"
            min={20}
            step={10}
            value={table.height}
            onChange={(e) =>
              updateTable(table.id, { height: toInt(e.target.value, 20) })
            }
          />
        </div>
      </div>

      <div className={fieldClass("rotation")}>
        <label htmlFor="fp-rotation">Rotation</label>
        <input
          id="fp-rotation"
          className="fp-input fp-num"
          type="number"
          min={0}
          max={345}
          step={15}
          value={table.rotation}
          onChange={(e) =>
            updateTable(table.id, { rotation: toInt(e.target.value, 0) })
          }
        />
      </div>

      <div className={fieldClass("assignPriority")}>
        <label htmlFor="fp-priority">Assign priority</label>
        <input
          id="fp-priority"
          className="fp-input fp-num"
          type="number"
          value={table.assignPriority}
          onChange={(e) =>
            updateTable(table.id, {
              assignPriority: toInt(e.target.value, 0),
            })
          }
        />
        <p className="fp-field-hint">Lower is offered first.</p>
      </div>

      <label className="fp-check">
        <input
          type="checkbox"
          checked={table.onlineBookable}
          onChange={(e) =>
            updateTable(table.id, { onlineBookable: e.target.checked })
          }
        />
        <span>Bookable online</span>
      </label>

      <label className="fp-check">
        <input
          type="checkbox"
          checked={table.isActive}
          onChange={(e) =>
            updateTable(table.id, { isActive: e.target.checked })
          }
        />
        <span>In service</span>
      </label>

      <div className={fieldClass("notes")}>
        <label htmlFor="fp-notes">Notes</label>
        <textarea
          id="fp-notes"
          className="fp-input fp-textarea"
          rows={3}
          value={table.notes ?? ""}
          onChange={(e) =>
            updateTable(table.id, { notes: e.target.value || null })
          }
        />
      </div>

      {combos.length > 0 && (
        <p className="fp-field-hint">
          In {combos.length === 1 ? "combination" : "combinations"}{" "}
          {combos.map((c) => c.label).join(", ")}.
        </p>
      )}
    </section>
  );
}

function toInt(value: string, fallback: number): number {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}
