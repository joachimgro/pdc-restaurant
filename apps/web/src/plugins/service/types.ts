import type {
  DiningTable,
  FloorPlanIssue,
  Room,
  TableCombination,
  TableShape,
} from "@lead-intake/shared-types";

/**
 * Editor document.
 *
 * Normalised rather than nested so a table move replaces one small object and
 * every other node keeps its identity. That is what makes whole-document
 * history snapshots cheap: structural sharing means undo costs a few pointers,
 * not a copy of 28 tables.
 */

/** A room without its tables — the tables live in the flat `tables` map. */
export type RoomMeta = Omit<Room, "tables">;

/** A table plus the room it belongs to, which the nested wire shape implies. */
export type EditorTable = DiningTable & { roomId: string };

export type Doc = {
  roomOrder: string[];
  rooms: Record<string, RoomMeta>;
  tables: Record<string, EditorTable>;
  combos: Record<string, TableCombination>;
};

/**
 * What an undo should put back on screen. Undoing a change you cannot see
 * reads as the editor doing nothing, so every entry carries the room and
 * tables it touched and the view follows the undo to them.
 */
export type HistoryEntry = {
  doc: Doc;
  roomId: string | null;
  tableIds: string[];
  /** Groups consecutive same-kind edits (arrow-key nudges) into one entry. */
  coalesceKey: string | null;
  at: number;
};

/**
 * A validation problem, from either side of the wire.
 *
 * The server reports tables by label because that is what its UNIQUE
 * constraint speaks; the editor needs an id to select one, so the mapper
 * resolves label to id against the document.
 */
export type NormalisedIssue = {
  source: "client" | "server";
  /** Room to switch to when this issue is clicked, when it maps to one. */
  roomId: string | null;
  /** Table to select and scroll into view, when it maps to one. */
  tableId: string | null;
  tableLabel: string | null;
  combinationLabel: string | null;
  /** Inspector field to highlight, e.g. "seatsMin". */
  field: string | null;
  message: string;
};

/** Outcome of a save attempt. The document is never mutated on failure. */
export type SaveOutcome =
  | { ok: true }
  | { ok: false; kind: "validation"; issues: NormalisedIssue[] }
  | { ok: false; kind: "permission" | "network"; message: string };

export type { DiningTable, FloorPlanIssue, Room, TableCombination, TableShape };
