import type { TableCombination } from "@lead-intake/shared-types";
import { tablesInRoom } from "./normalise";
import type { Doc, EditorTable } from "./types";

/** Schema caps: table label 16 chars, combination label 32, room name 64. */
const MAX_TABLE_LABEL = 16;
const MAX_COMBO_LABEL = 32;
const MAX_ROOM_NAME = 64;

export function newId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

/**
 * Default label prefix for a duplicated room's tables.
 *
 * Table labels are UNIQUE across the venue, so copies cannot keep theirs. The
 * first letter of the new room name is what a manager would have picked
 * anyway — Terrace gets T5, T6 — and it stays editable.
 */
export function defaultLabelPrefix(roomName: string): string {
  const initial = roomName.replace(/[^a-zA-Z0-9]/g, "").charAt(0);
  return initial ? initial.toUpperCase() : "C";
}

/**
 * A label that does not collide, preferring the prefixed form and falling back
 * to a numeric suffix. Returning something unique here rather than leaving the
 * clash for validation means duplicating a room is one action, not one action
 * plus twenty-eight corrections.
 */
export function deriveLabel(
  prefix: string,
  original: string,
  taken: Set<string>
): string {
  const base = `${prefix}${original}`.slice(0, MAX_TABLE_LABEL);
  if (!taken.has(base)) return base;

  for (let n = 2; n < 1000; n++) {
    const suffix = `-${n}`;
    const candidate =
      base.slice(0, MAX_TABLE_LABEL - suffix.length) + suffix;
    if (!taken.has(candidate)) return candidate;
  }
  return newId("t").slice(0, MAX_TABLE_LABEL);
}

export function duplicateRoomName(name: string, taken: Set<string>): string {
  const base = `${name} copy`.slice(0, MAX_ROOM_NAME);
  if (!taken.has(base)) return base;
  for (let n = 2; n < 1000; n++) {
    const candidate = `${name} copy ${n}`.slice(0, MAX_ROOM_NAME);
    if (!taken.has(candidate)) return candidate;
  }
  return base;
}

export type DuplicateResult = {
  doc: Doc;
  roomId: string;
  tableIds: string[];
};

/**
 * Copy a room, its tables, and any combination wholly contained by it.
 *
 * A combination spanning two rooms is deliberately not copied — half of its
 * member tables would be the originals, which is never what was meant.
 */
export function duplicateRoom(
  doc: Doc,
  sourceRoomId: string,
  labelPrefix: string
): DuplicateResult | null {
  const source = doc.rooms[sourceRoomId];
  if (!source) return null;

  const takenLabels = new Set(
    Object.values(doc.tables).map((t) => t.label)
  );
  const takenRoomNames = new Set(
    Object.values(doc.rooms).map((r) => r.name)
  );
  const takenComboLabels = new Set(
    Object.values(doc.combos).map((c) => c.label)
  );

  const newRoomId = newId("room");
  const rooms = {
    ...doc.rooms,
    [newRoomId]: {
      ...source,
      id: newRoomId,
      name: duplicateRoomName(source.name, takenRoomNames),
      sortOrder: Object.values(doc.rooms).length,
    },
  };

  const tables = { ...doc.tables };
  const idMap = new Map<string, string>();
  const newTableIds: string[] = [];

  for (const table of tablesInRoom(doc, sourceRoomId)) {
    const id = newId("tbl");
    const label = deriveLabel(labelPrefix, table.label, takenLabels);
    takenLabels.add(label);
    idMap.set(table.id, id);
    newTableIds.push(id);

    const copy: EditorTable = { ...table, id, label, roomId: newRoomId };
    tables[id] = copy;
  }

  const combos = { ...doc.combos };
  for (const combo of Object.values(doc.combos)) {
    const whollyInside = combo.tableIds.every(
      (id) => doc.tables[id]?.roomId === sourceRoomId
    );
    if (!whollyInside || combo.tableIds.length === 0) continue;

    const id = newId("combo");
    const label = deriveComboLabel(combo.label, takenComboLabels);
    takenComboLabels.add(label);

    const copy: TableCombination = {
      ...combo,
      id,
      label,
      tableIds: combo.tableIds.map((tid) => idMap.get(tid) ?? tid),
    };
    combos[id] = copy;
  }

  return {
    doc: {
      roomOrder: [...doc.roomOrder, newRoomId],
      rooms,
      tables,
      combos,
    },
    roomId: newRoomId,
    tableIds: newTableIds,
  };
}

function deriveComboLabel(original: string, taken: Set<string>): string {
  const base = `${original} copy`.slice(0, MAX_COMBO_LABEL);
  if (!taken.has(base)) return base;
  for (let n = 2; n < 1000; n++) {
    const candidate = `${original} copy ${n}`.slice(0, MAX_COMBO_LABEL);
    if (!taken.has(candidate)) return candidate;
  }
  return base;
}

/** Next free table label for a new table, e.g. "1", "2", "3". */
export function nextTableLabel(doc: Doc): string {
  const taken = new Set(Object.values(doc.tables).map((t) => t.label));
  for (let n = 1; n < 10000; n++) {
    const candidate = String(n);
    if (!taken.has(candidate)) return candidate;
  }
  return newId("t").slice(0, MAX_TABLE_LABEL);
}
