"use client";

import { useState } from "react";
import { ConsoleWorkspace } from "./console/ConsoleWorkspace";
import { LayoutWorkspace } from "./LayoutWorkspace";
import "./console/console.css";

/**
 * The Service section: the console during service, the floor plan editor when
 * building the room.
 *
 * Layout mode is deliberately harder to reach (spec §7). Nobody should
 * accidentally move table 12 at 8pm on a Friday, so it sits behind an explicit
 * toggle rather than a peer tab, and the console is what opens by default.
 */
export function ServiceWorkspace() {
  const [editingLayout, setEditingLayout] = useState(false);

  return (
    <div
      className="fp-root leads workspace-panel"
      style={{ gridColumn: "2 / -1" }}
    >
      <div className="sc-mode-bar">
        <span className="sc-mode-label">
          {editingLayout ? "Editing the floor plan" : "Service"}
        </span>
        <button
          type="button"
          className="sc-action"
          aria-pressed={editingLayout}
          onClick={() => setEditingLayout((v) => !v)}
        >
          {editingLayout ? "Done editing" : "Edit floor plan"}
        </button>
      </div>

      <div className="sc-mode-body">
        {editingLayout ? <LayoutWorkspace embedded /> : <ConsoleWorkspace />}
      </div>
    </div>
  );
}
