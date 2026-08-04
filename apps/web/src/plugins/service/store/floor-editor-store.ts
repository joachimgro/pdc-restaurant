"use client";

import { create } from "zustand";
import type { TableCombination, TableShape } from "@lead-intake/shared-types";
import { fetchFloorPlan, saveFloorPlan, validateDoc } from "../api";
import {
  duplicateRoom,
  defaultLabelPrefix,
  newId,
  nextTableLabel,
} from "../duplicate-room";
import {
  SHAPE_DEFAULTS,
  alignTables,
  clampToCanvas,
  distributeTables,
  snap,
  snapRotation,
  type AlignMode,
} from "../geometry";
import { emptyDoc, floorPlanToDoc, tablesInRoom } from "../normalise";
import type { Doc, EditorTable, HistoryEntry, NormalisedIssue } from "../types";

/** Spec floor is 20 steps; 50 costs nothing given structural sharing. */
const HISTORY_LIMIT = 50;

/** Window within which same-kind edits fold into one history entry. */
const COALESCE_MS = 500;

const DEFAULT_CANVAS = { width: 1200, height: 800 };

type Viewport = { zoom: number; panX: number; panY: number };

type CommitMeta = {
  roomId?: string | null;
  tableIds?: string[];
  coalesceKey?: string | null;
};

export type FloorEditorState = {
  status: "idle" | "loading" | "ready" | "error";
  loadError: string | null;

  doc: Doc;
  past: HistoryEntry[];
  future: HistoryEntry[];
  /** Reference-compared against `doc` for the dirty flag. */
  lastSavedDoc: Doc | null;

  activeRoomId: string | null;
  selection: string[];
  viewports: Record<string, Viewport>;

  /** Pre-drag snapshot. Present only between begin and commit/cancel. */
  interaction: { snapshot: Doc; meta: CommitMeta } | null;

  saving: boolean;
  issues: NormalisedIssue[];
  saveMessage: string | null;
  savedAt: number | null;
  highlight: { tableId: string | null; field: string | null } | null;

  /**
   * Shape armed from the palette, awaiting a canvas position.
   *
   * Placement is pointer-based, not HTML5 drag-and-drop, because that does not
   * work on iPad — and it serves both gestures: drag palette-to-canvas and tap
   * palette then tap canvas both finish on a canvas pointerup.
   */
  pendingShape: TableShape | null;
  setPendingShape: (shape: TableShape | null) => void;

  load: () => Promise<void>;
  save: () => Promise<void>;

  setActiveRoom: (roomId: string) => void;
  setSelection: (ids: string[]) => void;
  toggleSelected: (id: string) => void;
  clearSelection: () => void;
  setViewport: (roomId: string, viewport: Viewport) => void;

  beginInteraction: (meta: CommitMeta) => void;
  applyTransient: (updater: (doc: Doc) => Doc) => void;
  commitInteraction: () => void;
  cancelInteraction: () => void;
  commit: (updater: (doc: Doc) => Doc, meta?: CommitMeta) => void;

  undo: () => void;
  redo: () => void;

  addTable: (shape: TableShape, posX: number, posY: number) => void;
  updateTable: (id: string, patch: Partial<EditorTable>) => void;
  nudgeSelection: (dx: number, dy: number) => void;
  rotateSelection: (deltaDeg: number) => void;
  deleteSelection: () => void;
  alignSelection: (mode: AlignMode) => void;
  distributeSelection: (axis: "x" | "y") => void;

  addRoom: (name: string) => void;
  updateRoom: (roomId: string, patch: Partial<Doc["rooms"][string]>) => void;
  archiveRoom: (roomId: string) => void;
  duplicateActiveRoom: () => void;

  createCombination: () => void;
  updateCombination: (id: string, patch: Partial<TableCombination>) => void;
  deleteCombination: (id: string) => void;

  focusIssue: (issue: NormalisedIssue) => void;
  dismissSaveMessage: () => void;
};

function pushHistory(
  state: Pick<FloorEditorState, "past" | "doc">,
  meta: CommitMeta
): HistoryEntry[] {
  const entry: HistoryEntry = {
    doc: state.doc,
    roomId: meta.roomId ?? null,
    tableIds: meta.tableIds ?? [],
    coalesceKey: meta.coalesceKey ?? null,
    at: Date.now(),
  };
  const next = [...state.past, entry];
  return next.length > HISTORY_LIMIT ? next.slice(-HISTORY_LIMIT) : next;
}

/** Selection restricted to tables that exist — undo can remove them. */
function pruneSelection(doc: Doc, ids: string[]): string[] {
  return ids.filter((id) => doc.tables[id]);
}

export const useFloorEditor = create<FloorEditorState>((set, get) => ({
  status: "idle",
  loadError: null,

  doc: emptyDoc(),
  past: [],
  future: [],
  lastSavedDoc: null,

  activeRoomId: null,
  selection: [],
  viewports: {},
  interaction: null,

  saving: false,
  issues: [],
  saveMessage: null,
  savedAt: null,
  highlight: null,
  pendingShape: null,

  setPendingShape: (shape) => set({ pendingShape: shape }),

  load: async () => {
    set({ status: "loading", loadError: null });
    try {
      const doc = floorPlanToDoc(await fetchFloorPlan());
      const firstActive =
        doc.roomOrder.find((id) => doc.rooms[id]?.isActive) ??
        doc.roomOrder[0] ??
        null;
      const viewports: Record<string, Viewport> = {};
      for (const id of doc.roomOrder) {
        viewports[id] = { zoom: 1, panX: 0, panY: 0 };
      }
      set({
        status: "ready",
        doc,
        lastSavedDoc: doc,
        past: [],
        future: [],
        activeRoomId: firstActive,
        selection: [],
        viewports,
        issues: [],
      });
    } catch (err) {
      set({
        status: "error",
        loadError:
          err instanceof Error ? err.message : "Could not load the floor plan.",
      });
    }
  },

  save: async () => {
    const { doc, saving } = get();
    if (saving) return;

    // Fast path: the same validator the Worker runs, so the common mistakes
    // surface without a round trip. The server still decides.
    const clientIssues = validateDoc(doc);
    if (clientIssues.length > 0) {
      set({ issues: clientIssues, saveMessage: null });
      return;
    }

    set({ saving: true, issues: [], saveMessage: null });
    const result = await saveFloorPlan(doc);

    if (result.ok && result.plan) {
      // Rebase onto server truth. History is kept: a save is not a reason to
      // lose the ability to undo what came before it.
      const savedDoc = floorPlanToDoc(result.plan);
      set({
        saving: false,
        doc: savedDoc,
        lastSavedDoc: savedDoc,
        selection: pruneSelection(savedDoc, get().selection),
        issues: [],
        savedAt: Date.now(),
        saveMessage: null,
      });
      return;
    }

    if (!result.ok && result.kind === "validation") {
      // The document is untouched and still dirty — nothing is lost.
      set({ saving: false, issues: result.issues });
      return;
    }

    set({
      saving: false,
      saveMessage: !result.ok ? result.message : null,
    });
  },

  setActiveRoom: (roomId) =>
    set({ activeRoomId: roomId, selection: [], highlight: null }),

  setSelection: (ids) => set({ selection: ids, highlight: null }),

  toggleSelected: (id) =>
    set((s) => ({
      selection: s.selection.includes(id)
        ? s.selection.filter((x) => x !== id)
        : [...s.selection, id],
      highlight: null,
    })),

  clearSelection: () => set({ selection: [], highlight: null }),

  setViewport: (roomId, viewport) =>
    set((s) => ({ viewports: { ...s.viewports, [roomId]: viewport } })),

  // ── History ───────────────────────────────────────────────────────────────

  /**
   * A drag is one history entry, not sixty. Pointer-move writes through
   * `applyTransient`; only `commitInteraction` pushes the pre-drag snapshot.
   */
  beginInteraction: (meta) =>
    set((s) => ({ interaction: { snapshot: s.doc, meta } })),

  applyTransient: (updater) => set((s) => ({ doc: updater(s.doc) })),

  commitInteraction: () => {
    const { interaction, doc } = get();
    if (!interaction) return;
    // A drag that ended where it started is not an edit.
    if (interaction.snapshot === doc) {
      set({ interaction: null });
      return;
    }
    set((s) => ({
      past: pushHistory({ past: s.past, doc: interaction.snapshot }, interaction.meta),
      future: [],
      interaction: null,
    }));
  },

  cancelInteraction: () => {
    const { interaction } = get();
    if (!interaction) return;
    set({ doc: interaction.snapshot, interaction: null });
  },

  commit: (updater, meta = {}) =>
    set((s) => {
      const nextDoc = updater(s.doc);
      if (nextDoc === s.doc) return {};

      const last = s.past[s.past.length - 1];
      const canCoalesce =
        meta.coalesceKey != null &&
        last != null &&
        last.coalesceKey === meta.coalesceKey &&
        Date.now() - last.at < COALESCE_MS;

      if (canCoalesce) {
        // Fold into the existing entry: undo goes back to before the whole run
        // of nudges, not one keypress at a time.
        const refreshed = [...s.past];
        refreshed[refreshed.length - 1] = { ...last, at: Date.now() };
        return { doc: nextDoc, past: refreshed, future: [] };
      }

      return {
        doc: nextDoc,
        past: pushHistory(s, meta),
        future: [],
      };
    }),

  undo: () =>
    set((s) => {
      const entry = s.past[s.past.length - 1];
      if (!entry) return {};
      const restored = entry.doc;
      return {
        doc: restored,
        past: s.past.slice(0, -1),
        future: [
          { ...entry, doc: s.doc, at: Date.now() },
          ...s.future,
        ].slice(0, HISTORY_LIMIT),
        // The view follows the undo: an edit reversed off-screen reads as
        // nothing having happened.
        activeRoomId:
          entry.roomId && restored.rooms[entry.roomId]
            ? entry.roomId
            : s.activeRoomId,
        selection: pruneSelection(restored, entry.tableIds),
        highlight: null,
      };
    }),

  redo: () =>
    set((s) => {
      const entry = s.future[0];
      if (!entry) return {};
      const restored = entry.doc;
      return {
        doc: restored,
        future: s.future.slice(1),
        past: pushHistory(s, {
          roomId: entry.roomId,
          tableIds: entry.tableIds,
          coalesceKey: null,
        }),
        activeRoomId:
          entry.roomId && restored.rooms[entry.roomId]
            ? entry.roomId
            : s.activeRoomId,
        selection: pruneSelection(restored, entry.tableIds),
        highlight: null,
      };
    }),

  // ── Tables ────────────────────────────────────────────────────────────────

  addTable: (shape, posX, posY) => {
    const { activeRoomId, doc } = get();
    if (!activeRoomId) return;
    const room = doc.rooms[activeRoomId];
    if (!room) return;

    const defaults = SHAPE_DEFAULTS[shape];
    const id = newId("tbl");
    const position = clampToCanvas(
      {
        posX: snap(posX - defaults.width / 2),
        posY: snap(posY - defaults.height / 2),
        width: defaults.width,
        height: defaults.height,
      },
      room
    );

    const table: EditorTable = {
      id,
      roomId: activeRoomId,
      label: nextTableLabel(doc),
      seatsMin: defaults.seatsMin,
      seatsMax: defaults.seatsMax,
      shape,
      posX: position.posX,
      posY: position.posY,
      width: defaults.width,
      height: defaults.height,
      rotation: 0,
      onlineBookable: true,
      assignPriority: 100,
      isActive: true,
      notes: null,
    };

    get().commit(
      (d) => ({ ...d, tables: { ...d.tables, [id]: table } }),
      { roomId: activeRoomId, tableIds: [id] }
    );
    set({ selection: [id] });
  },

  updateTable: (id, patch) => {
    const table = get().doc.tables[id];
    if (!table) return;
    get().commit(
      (d) => ({
        ...d,
        tables: { ...d.tables, [id]: { ...d.tables[id], ...patch } },
      }),
      {
        roomId: table.roomId,
        tableIds: [id],
        // Typing in a field should not cost one undo per keystroke.
        coalesceKey: `edit:${id}:${Object.keys(patch).join(",")}`,
      }
    );
  },

  nudgeSelection: (dx, dy) => {
    const { selection, doc, activeRoomId } = get();
    if (selection.length === 0 || !activeRoomId) return;
    const room = doc.rooms[activeRoomId];
    if (!room) return;

    get().commit(
      (d) => {
        const tables = { ...d.tables };
        for (const id of selection) {
          const t = tables[id];
          if (!t) continue;
          const moved = clampToCanvas(
            { ...t, posX: t.posX + dx, posY: t.posY + dy },
            room
          );
          tables[id] = { ...t, ...moved };
        }
        return { ...d, tables };
      },
      {
        roomId: activeRoomId,
        tableIds: selection,
        coalesceKey: `nudge:${selection.join(",")}`,
      }
    );
  },

  rotateSelection: (deltaDeg) => {
    const { selection, activeRoomId } = get();
    if (selection.length === 0) return;
    get().commit(
      (d) => {
        const tables = { ...d.tables };
        for (const id of selection) {
          const t = tables[id];
          if (!t) continue;
          tables[id] = { ...t, rotation: snapRotation(t.rotation + deltaDeg) };
        }
        return { ...d, tables };
      },
      {
        roomId: activeRoomId,
        tableIds: selection,
        coalesceKey: `rotate:${selection.join(",")}`,
      }
    );
  },

  deleteSelection: () => {
    const { selection, activeRoomId } = get();
    if (selection.length === 0) return;
    const removing = new Set(selection);

    get().commit(
      (d) => {
        const tables = { ...d.tables };
        for (const id of removing) delete tables[id];

        // A combination must never outlive its tables — that is exactly the
        // orphan that makes assignment return tables which do not exist.
        const combos: Doc["combos"] = {};
        for (const combo of Object.values(d.combos)) {
          const remaining = combo.tableIds.filter((id) => !removing.has(id));
          if (remaining.length < 2) continue;
          combos[combo.id] = { ...combo, tableIds: remaining };
        }
        return { ...d, tables, combos };
      },
      { roomId: activeRoomId, tableIds: [] }
    );
    set({ selection: [] });
  },

  alignSelection: (mode) => {
    const { selection, doc, activeRoomId } = get();
    if (selection.length < 2) return;
    const tables = selection
      .map((id) => doc.tables[id])
      .filter((t): t is EditorTable => Boolean(t));
    const moves = alignTables(tables, mode);
    applyMoves(get, moves, activeRoomId, selection);
  },

  distributeSelection: (axis) => {
    const { selection, doc, activeRoomId } = get();
    if (selection.length < 3) return;
    const tables = selection
      .map((id) => doc.tables[id])
      .filter((t): t is EditorTable => Boolean(t));
    const moves = distributeTables(tables, axis);
    applyMoves(get, moves, activeRoomId, selection);
  },

  // ── Rooms ─────────────────────────────────────────────────────────────────

  addRoom: (name) => {
    const id = newId("room");
    get().commit(
      (d) => ({
        ...d,
        roomOrder: [...d.roomOrder, id],
        rooms: {
          ...d.rooms,
          [id]: {
            id,
            name,
            accentColor: null,
            onlineBookable: true,
            canvasWidth: DEFAULT_CANVAS.width,
            canvasHeight: DEFAULT_CANVAS.height,
            sortOrder: d.roomOrder.length,
            isActive: true,
          },
        },
      }),
      { roomId: id, tableIds: [] }
    );
    set({ activeRoomId: id, selection: [] });
  },

  updateRoom: (roomId, patch) => {
    if (!get().doc.rooms[roomId]) return;
    get().commit(
      (d) => ({
        ...d,
        rooms: { ...d.rooms, [roomId]: { ...d.rooms[roomId], ...patch } },
      }),
      {
        roomId,
        tableIds: [],
        coalesceKey: `room:${roomId}:${Object.keys(patch).join(",")}`,
      }
    );
  },

  /**
   * Archive, not delete. `PUT /service/floor-plan` cannot remove a room —
   * unsubmitted rooms are left alone and submitted ones only have their tables
   * replaced — so the honest operation is to mark it inactive.
   */
  archiveRoom: (roomId) => {
    const { doc } = get();
    if (!doc.rooms[roomId]) return;
    get().commit(
      (d) => ({
        ...d,
        rooms: { ...d.rooms, [roomId]: { ...d.rooms[roomId], isActive: false } },
      }),
      { roomId, tableIds: [] }
    );
    const nextActive =
      get().doc.roomOrder.find(
        (id) => id !== roomId && get().doc.rooms[id]?.isActive
      ) ?? null;
    set({ activeRoomId: nextActive, selection: [] });
  },

  duplicateActiveRoom: () => {
    const { activeRoomId, doc } = get();
    if (!activeRoomId) return;
    const source = doc.rooms[activeRoomId];
    if (!source) return;

    const result = duplicateRoom(
      doc,
      activeRoomId,
      defaultLabelPrefix(`${source.name} copy`)
    );
    if (!result) return;

    get().commit(() => result.doc, {
      roomId: result.roomId,
      tableIds: result.tableIds,
    });
    set({ activeRoomId: result.roomId, selection: [] });
  },

  // ── Combinations ──────────────────────────────────────────────────────────

  createCombination: () => {
    const { selection, doc, activeRoomId } = get();
    if (selection.length < 2) return;

    const members = selection
      .map((id) => doc.tables[id])
      .filter((t): t is EditorTable => Boolean(t));
    if (members.length < 2) return;

    const id = newId("combo");
    const label = members
      .map((t) => t.label)
      .join("+")
      .slice(0, 32);

    const combo: TableCombination = {
      id,
      label,
      // Sensible starting range: the members' seats added up.
      seatsMin: Math.min(
        100,
        members.reduce((sum, t) => sum + t.seatsMin, 0)
      ),
      seatsMax: Math.min(
        100,
        members.reduce((sum, t) => sum + t.seatsMax, 0)
      ),
      assignPriority: 300,
      onlineBookable: true,
      isActive: true,
      tableIds: members.map((t) => t.id),
    };

    get().commit((d) => ({ ...d, combos: { ...d.combos, [id]: combo } }), {
      roomId: activeRoomId,
      tableIds: combo.tableIds,
    });
  },

  updateCombination: (id, patch) => {
    if (!get().doc.combos[id]) return;
    get().commit(
      (d) => ({
        ...d,
        combos: { ...d.combos, [id]: { ...d.combos[id], ...patch } },
      }),
      {
        roomId: get().activeRoomId,
        tableIds: [],
        coalesceKey: `combo:${id}:${Object.keys(patch).join(",")}`,
      }
    );
  },

  deleteCombination: (id) => {
    get().commit(
      (d) => {
        const combos = { ...d.combos };
        delete combos[id];
        return { ...d, combos };
      },
      { roomId: get().activeRoomId, tableIds: [] }
    );
  },

  // ── Issues ────────────────────────────────────────────────────────────────

  focusIssue: (issue) =>
    set((s) => ({
      activeRoomId: issue.roomId ?? s.activeRoomId,
      selection: issue.tableId ? [issue.tableId] : [],
      highlight: { tableId: issue.tableId, field: issue.field },
    })),

  dismissSaveMessage: () => set({ saveMessage: null }),
}));

function applyMoves(
  get: () => FloorEditorState,
  moves: Record<string, { posX: number; posY: number }>,
  roomId: string | null,
  selection: string[]
): void {
  if (Object.keys(moves).length === 0) return;
  const room = roomId ? get().doc.rooms[roomId] : null;
  get().commit(
    (d) => {
      const tables = { ...d.tables };
      for (const [id, pos] of Object.entries(moves)) {
        const t = tables[id];
        if (!t) continue;
        const next = room ? clampToCanvas({ ...t, ...pos }, room) : pos;
        tables[id] = { ...t, ...next };
      }
      return { ...d, tables };
    },
    { roomId, tableIds: selection }
  );
}

// ── Selectors ───────────────────────────────────────────────────────────────

export function selectIsDirty(s: FloorEditorState): boolean {
  return s.lastSavedDoc !== null && s.doc !== s.lastSavedDoc;
}

export function selectActiveTables(s: FloorEditorState): EditorTable[] {
  return s.activeRoomId ? tablesInRoom(s.doc, s.activeRoomId) : [];
}

export function selectVisibleRooms(s: FloorEditorState) {
  return s.doc.roomOrder
    .map((id) => s.doc.rooms[id])
    .filter((r) => r && r.isActive);
}
