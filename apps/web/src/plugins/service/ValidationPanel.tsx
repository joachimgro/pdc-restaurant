"use client";

import { IconWarning } from "./icons";
import { useFloorEditor } from "./store/floor-editor-store";

/**
 * Validation problems from either side of the wire, made navigable.
 *
 * A list of messages a manager cannot act on is barely better than a failed
 * save, so every issue that resolves to a table jumps to it: right room, table
 * selected, offending field flagged in the inspector.
 */
export function ValidationPanel() {
  const issues = useFloorEditor((s) => s.issues);
  const doc = useFloorEditor((s) => s.doc);
  const focusIssue = useFloorEditor((s) => s.focusIssue);

  if (issues.length === 0) return null;

  const fromServer = issues.some((i) => i.source === "server");

  return (
    <section
      className="fp-issues"
      role="alert"
      aria-label="Floor plan problems"
    >
      <header className="fp-issues-head">
        <IconWarning />
        <h3>
          {issues.length} {issues.length === 1 ? "problem" : "problems"}
        </h3>
      </header>
      <p className="fp-issues-note">
        {fromServer
          ? "The server rejected this layout. Nothing was saved and your work is still here."
          : "Fix these before saving."}
      </p>
      <ul className="fp-issue-list">
        {issues.map((issue, index) => {
          const target =
            issue.tableId && doc.tables[issue.tableId]
              ? `Table ${doc.tables[issue.tableId].label}`
              : issue.combinationLabel
                ? `Combination ${issue.combinationLabel}`
                : issue.roomId && doc.rooms[issue.roomId]
                  ? doc.rooms[issue.roomId].name
                  : "This venue";

          const navigable = Boolean(issue.roomId || issue.tableId);

          return (
            <li key={`${issue.message}-${index}`}>
              <button
                type="button"
                className="fp-issue"
                onClick={() => focusIssue(issue)}
                disabled={!navigable}
              >
                <span className="fp-issue-target">{target}</span>
                <span className="fp-issue-message">{issue.message}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
