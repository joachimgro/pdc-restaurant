import type { FloorPlan } from "@lead-intake/shared-types";
import type { Doc, EditorTable, RoomMeta } from "./types";

/** Wire shape (nested rooms → tables) into the flat editor document. */
export function floorPlanToDoc(plan: FloorPlan): Doc {
  const rooms: Record<string, RoomMeta> = {};
  const tables: Record<string, EditorTable> = {};
  const roomOrder: string[] = [];

  const ordered = [...plan.rooms].sort(
    (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)
  );

  for (const room of ordered) {
    const { tables: roomTables, ...meta } = room;
    rooms[room.id] = meta;
    roomOrder.push(room.id);
    for (const table of roomTables) {
      tables[table.id] = { ...table, roomId: room.id };
    }
  }

  const combos: Record<string, (typeof plan.combinations)[number]> = {};
  for (const combo of plan.combinations) combos[combo.id] = combo;

  return { roomOrder, rooms, tables, combos };
}

/**
 * The editor document back onto the wire.
 *
 * Always the whole plan, every room. `saveFloorPlan` deletes every
 * combination for the location and rebuilds them from the payload, and
 * `validateFloorPlan` rejects a combination whose member tables are absent —
 * so submitting a single room would destroy the combinations in every other
 * room. Whole-plan is not a convenience here, it is a correctness requirement.
 */
export function docToFloorPlan(doc: Doc): FloorPlan {
  return {
    rooms: doc.roomOrder.map((roomId) => ({
      ...doc.rooms[roomId],
      tables: tablesInRoom(doc, roomId),
    })),
    combinations: Object.values(doc.combos),
  };
}

/** Tables of one room, in a stable order so payloads and tab order agree. */
export function tablesInRoom(doc: Doc, roomId: string): EditorTable[] {
  return Object.values(doc.tables)
    .filter((t) => t.roomId === roomId)
    .sort(
      (a, b) =>
        a.posY - b.posY ||
        a.posX - b.posX ||
        a.label.localeCompare(b.label, undefined, { numeric: true })
    );
}

/** Tables of one room without the position sort — used where order is fixed. */
export function tableIdsInRoom(doc: Doc, roomId: string): string[] {
  return tablesInRoom(doc, roomId).map((t) => t.id);
}

export function emptyDoc(): Doc {
  return { roomOrder: [], rooms: {}, tables: {}, combos: {} };
}

/** Combinations every one of whose member tables sits in the given room. */
export function combosForRoom(doc: Doc, roomId: string) {
  return Object.values(doc.combos).filter((combo) =>
    combo.tableIds.some((id) => doc.tables[id]?.roomId === roomId)
  );
}

/** Combinations that include a given table. */
export function combosForTable(doc: Doc, tableId: string) {
  return Object.values(doc.combos).filter((c) => c.tableIds.includes(tableId));
}
