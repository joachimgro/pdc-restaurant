"use client";

import { IconLink, IconTrash } from "./icons";
import { combosForRoom } from "./normalise";
import { useFloorEditor } from "./store/floor-editor-store";

export function CombinationPanel() {
  const doc = useFloorEditor((s) => s.doc);
  const activeRoomId = useFloorEditor((s) => s.activeRoomId);
  const selection = useFloorEditor((s) => s.selection);
  const createCombination = useFloorEditor((s) => s.createCombination);
  const updateCombination = useFloorEditor((s) => s.updateCombination);
  const deleteCombination = useFloorEditor((s) => s.deleteCombination);
  const setSelection = useFloorEditor((s) => s.setSelection);

  if (!activeRoomId) return null;
  const combos = combosForRoom(doc, activeRoomId);

  return (
    <section className="fp-combos" aria-label="Combinations">
      <h3 className="fp-panel-title">Combinations</h3>

      <button
        type="button"
        className="fp-btn fp-btn-wide"
        disabled={selection.length < 2}
        onClick={createCombination}
      >
        <IconLink />
        Join as combination
      </button>
      {selection.length < 2 && (
        <p className="fp-panel-hint">Select two or more tables to join them.</p>
      )}

      {combos.length === 0 ? (
        <p className="fp-panel-hint">No combinations in this room yet.</p>
      ) : (
        <ul className="fp-combo-list">
          {combos.map((combo) => (
            <li key={combo.id} className="fp-combo">
              <div className="fp-combo-head">
                <input
                  className="fp-input fp-input-inline"
                  value={combo.label}
                  maxLength={32}
                  aria-label={`Combination label, currently ${combo.label}`}
                  onChange={(e) =>
                    updateCombination(combo.id, { label: e.target.value })
                  }
                />
                <button
                  type="button"
                  className="fp-icon-btn"
                  aria-label={`Delete combination ${combo.label}`}
                  onClick={() => deleteCombination(combo.id)}
                >
                  <IconTrash />
                </button>
              </div>

              <div className="fp-field-row">
                <div className="fp-field">
                  <label htmlFor={`combo-min-${combo.id}`}>Seats min</label>
                  <input
                    id={`combo-min-${combo.id}`}
                    className="fp-input fp-num"
                    type="number"
                    min={1}
                    max={100}
                    value={combo.seatsMin}
                    onChange={(e) =>
                      updateCombination(combo.id, {
                        seatsMin: Number.parseInt(e.target.value, 10) || 1,
                      })
                    }
                  />
                </div>
                <div className="fp-field">
                  <label htmlFor={`combo-max-${combo.id}`}>Seats max</label>
                  <input
                    id={`combo-max-${combo.id}`}
                    className="fp-input fp-num"
                    type="number"
                    min={1}
                    max={100}
                    value={combo.seatsMax}
                    onChange={(e) =>
                      updateCombination(combo.id, {
                        seatsMax: Number.parseInt(e.target.value, 10) || 1,
                      })
                    }
                  />
                </div>
              </div>

              <button
                type="button"
                className="fp-combo-members"
                onClick={() => setSelection(combo.tableIds)}
              >
                Tables{" "}
                <span className="fp-num">
                  {combo.tableIds
                    .map((id) => doc.tables[id]?.label ?? "?")
                    .join(", ")}
                </span>
              </button>

              <label className="fp-check">
                <input
                  type="checkbox"
                  checked={combo.onlineBookable}
                  onChange={(e) =>
                    updateCombination(combo.id, {
                      onlineBookable: e.target.checked,
                    })
                  }
                />
                <span>Bookable online</span>
              </label>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
