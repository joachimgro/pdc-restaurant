"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CombinationPanel } from "./CombinationPanel";
import { FloorCanvas } from "./FloorCanvas";
import {
  IconAlign,
  IconDistribute,
  IconDuplicate,
  IconFit,
  IconPlus,
  IconRedo,
  IconRotate,
  IconTrash,
  IconUndo,
  IconZoomIn,
  IconZoomOut,
} from "./icons";
import { MAX_ZOOM, MIN_ZOOM, NUDGE_LARGE, NUDGE_SMALL, clamp } from "./geometry";
import { ShapePalette } from "./ShapePalette";
import { TableInspector } from "./TableInspector";
import { ValidationPanel } from "./ValidationPanel";
import {
  selectIsDirty,
  selectVisibleRooms,
  useFloorEditor,
} from "./store/floor-editor-store";
import "./service.css";

const ALIGN_MODES = [
  { mode: "left", label: "Align left" },
  { mode: "centre-x", label: "Align centres vertically" },
  { mode: "right", label: "Align right" },
  { mode: "top", label: "Align top" },
  { mode: "centre-y", label: "Align centres horizontally" },
  { mode: "bottom", label: "Align bottom" },
] as const;

export function ServiceWorkspace() {
  const status = useFloorEditor((s) => s.status);
  const loadError = useFloorEditor((s) => s.loadError);
  const load = useFloorEditor((s) => s.load);

  useEffect(() => {
    if (useFloorEditor.getState().status === "idle") void load();
  }, [load]);

  if (status === "loading" || status === "idle") {
    return <div className="fp-loading">Loading the floor plan</div>;
  }

  if (status === "error") {
    return (
      <div className="fp-loading fp-loading-error">
        <p>{loadError}</p>
        <button type="button" className="fp-btn" onClick={() => void load()}>
          Try again
        </button>
      </div>
    );
  }

  return <FloorPlanEditor />;
}

function FloorPlanEditor() {
  const doc = useFloorEditor((s) => s.doc);
  const rooms = useFloorEditor(selectVisibleRooms);
  const activeRoomId = useFloorEditor((s) => s.activeRoomId);
  const selection = useFloorEditor((s) => s.selection);
  const dirty = useFloorEditor(selectIsDirty);
  const saving = useFloorEditor((s) => s.saving);
  const savedAt = useFloorEditor((s) => s.savedAt);
  const saveMessage = useFloorEditor((s) => s.saveMessage);
  const past = useFloorEditor((s) => s.past);
  const future = useFloorEditor((s) => s.future);
  const viewport = useFloorEditor((s) =>
    activeRoomId ? (s.viewports[activeRoomId] ?? { zoom: 1, panX: 0, panY: 0 }) : null
  );

  const store = useFloorEditor;
  const [context, setContext] = useState<{
    tableId: string;
    x: number;
    y: number;
  } | null>(null);

  const room = activeRoomId ? doc.rooms[activeRoomId] : null;

  useDirtyGuard(dirty);
  useEditorKeyboard();

  const setZoom = useCallback(
    (zoom: number) => {
      if (!activeRoomId || !viewport) return;
      store
        .getState()
        .setViewport(activeRoomId, {
          ...viewport,
          zoom: clamp(zoom, MIN_ZOOM, MAX_ZOOM),
        });
    },
    [activeRoomId, store, viewport]
  );

  return (
    <div className="fp-root">
      <header className="fp-topbar">
        <div className="fp-tabs" role="tablist" aria-label="Rooms">
          {rooms.map((r) => (
            <button
              key={r.id}
              role="tab"
              type="button"
              aria-selected={r.id === activeRoomId}
              className={`fp-tab${r.id === activeRoomId ? " is-active" : ""}`}
              onClick={() => store.getState().setActiveRoom(r.id)}
            >
              {r.name}
              <span className="fp-tab-count fp-num">
                {Object.values(doc.tables).filter((t) => t.roomId === r.id).length}
              </span>
            </button>
          ))}
          <button
            type="button"
            className="fp-tab fp-tab-add"
            onClick={() => {
              const name = window.prompt("Room name", "New room");
              if (name?.trim()) store.getState().addRoom(name.trim());
            }}
          >
            <IconPlus />
            <span className="fp-sr-only">Add a room</span>
          </button>
        </div>

        <div className="fp-save-group">
          <span
            className={`fp-dirty${dirty ? " is-dirty" : ""}`}
            aria-live="polite"
          >
            {dirty
              ? "Unsaved changes"
              : savedAt
                ? "Saved"
                : "No changes"}
          </span>
          <button
            type="button"
            className="fp-btn fp-btn-primary"
            disabled={!dirty || saving}
            onClick={() => void store.getState().save()}
          >
            {saving ? "Saving" : "Save layout"}
          </button>
        </div>
      </header>

      {saveMessage && (
        <div className="fp-banner" role="alert">
          <span>{saveMessage}</span>
          <button
            type="button"
            className="fp-btn fp-btn-quiet"
            onClick={() => store.getState().dismissSaveMessage()}
          >
            Dismiss
          </button>
        </div>
      )}

      <div className="fp-toolbar" role="toolbar" aria-label="Layout tools">
        <ToolButton
          label="Undo"
          disabled={past.length === 0}
          onClick={() => store.getState().undo()}
        >
          <IconUndo />
        </ToolButton>
        <ToolButton
          label="Redo"
          disabled={future.length === 0}
          onClick={() => store.getState().redo()}
        >
          <IconRedo />
        </ToolButton>

        <span className="fp-toolbar-divider" role="separator" />

        {ALIGN_MODES.map(({ mode, label }) => (
          <ToolButton
            key={mode}
            label={label}
            disabled={selection.length < 2}
            onClick={() => store.getState().alignSelection(mode)}
          >
            <IconAlign mode={mode} />
          </ToolButton>
        ))}
        <ToolButton
          label="Distribute horizontally"
          disabled={selection.length < 3}
          onClick={() => store.getState().distributeSelection("x")}
        >
          <IconDistribute axis="x" />
        </ToolButton>
        <ToolButton
          label="Distribute vertically"
          disabled={selection.length < 3}
          onClick={() => store.getState().distributeSelection("y")}
        >
          <IconDistribute axis="y" />
        </ToolButton>

        <span className="fp-toolbar-divider" role="separator" />

        <ToolButton
          label="Rotate 15 degrees"
          disabled={selection.length === 0}
          onClick={() => store.getState().rotateSelection(15)}
        >
          <IconRotate />
        </ToolButton>
        <ToolButton
          label="Delete selected tables"
          disabled={selection.length === 0}
          onClick={() => store.getState().deleteSelection()}
        >
          <IconTrash />
        </ToolButton>

        <span className="fp-toolbar-divider" role="separator" />

        <ToolButton
          label="Zoom out"
          disabled={!viewport}
          onClick={() => viewport && setZoom(viewport.zoom / 1.25)}
        >
          <IconZoomOut />
        </ToolButton>
        <ToolButton
          label="Fit to screen"
          disabled={!activeRoomId}
          onClick={() =>
            activeRoomId &&
            store.getState().setViewport(activeRoomId, {
              zoom: 1,
              panX: 0,
              panY: 0,
            })
          }
        >
          <IconFit />
        </ToolButton>
        <ToolButton
          label="Zoom in"
          disabled={!viewport}
          onClick={() => viewport && setZoom(viewport.zoom * 1.25)}
        >
          <IconZoomIn />
        </ToolButton>

        <span className="fp-toolbar-spacer" />

        <ToolButton
          label="Duplicate this room"
          disabled={!activeRoomId}
          onClick={() => store.getState().duplicateActiveRoom()}
        >
          <IconDuplicate />
        </ToolButton>
      </div>

      <div className="fp-body">
        <aside className="fp-side fp-side-left">
          <ShapePalette />
          {room && <RoomSettings roomId={room.id} />}
        </aside>

        <main className="fp-stage">
          {room ? (
            <FloorCanvas
              key={room.id}
              room={room}
              onLongPress={(tableId, x, y) => setContext({ tableId, x, y })}
            />
          ) : (
            <div className="fp-empty">
              <p>No rooms yet.</p>
              <button
                type="button"
                className="fp-btn fp-btn-primary"
                onClick={() => store.getState().addRoom("Main Dining")}
              >
                Create the first room
              </button>
            </div>
          )}
        </main>

        <aside className="fp-side fp-side-right">
          <ValidationPanel />
          <TableInspector />
          <CombinationPanel />
        </aside>
      </div>

      {context && (
        <ContextSheet
          tableId={context.tableId}
          x={context.x}
          y={context.y}
          onClose={() => setContext(null)}
        />
      )}
    </div>
  );
}

function ToolButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className="fp-tool"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function RoomSettings({ roomId }: { roomId: string }) {
  const room = useFloorEditor((s) => s.doc.rooms[roomId]);
  const updateRoom = useFloorEditor((s) => s.updateRoom);
  const archiveRoom = useFloorEditor((s) => s.archiveRoom);
  if (!room) return null;

  return (
    <section className="fp-room-settings" aria-label="Room settings">
      <h3 className="fp-panel-title">Room</h3>

      <div className="fp-field">
        <label htmlFor="fp-room-name">Name</label>
        <input
          id="fp-room-name"
          className="fp-input"
          value={room.name}
          maxLength={64}
          onChange={(e) => updateRoom(roomId, { name: e.target.value })}
        />
      </div>

      <div className="fp-field-row">
        <div className="fp-field">
          <label htmlFor="fp-room-w">Canvas width</label>
          <input
            id="fp-room-w"
            className="fp-input fp-num"
            type="number"
            min={100}
            max={10000}
            step={100}
            value={room.canvasWidth}
            onChange={(e) =>
              updateRoom(roomId, {
                canvasWidth: Number.parseInt(e.target.value, 10) || 100,
              })
            }
          />
        </div>
        <div className="fp-field">
          <label htmlFor="fp-room-h">Canvas height</label>
          <input
            id="fp-room-h"
            className="fp-input fp-num"
            type="number"
            min={100}
            max={10000}
            step={100}
            value={room.canvasHeight}
            onChange={(e) =>
              updateRoom(roomId, {
                canvasHeight: Number.parseInt(e.target.value, 10) || 100,
              })
            }
          />
        </div>
      </div>

      <label className="fp-check">
        <input
          type="checkbox"
          checked={room.onlineBookable}
          onChange={(e) =>
            updateRoom(roomId, { onlineBookable: e.target.checked })
          }
        />
        <span>Bookable online</span>
      </label>

      <button
        type="button"
        className="fp-btn fp-btn-danger"
        onClick={() => {
          const ok = window.confirm(
            `Take "${room.name}" out of service? Its tables are kept, and it stops being offered for bookings. Save the layout to apply it.`
          );
          if (ok) archiveRoom(roomId);
        }}
      >
        Take room out of service
      </button>
    </section>
  );
}

function ContextSheet({
  tableId,
  x,
  y,
  onClose,
}: {
  tableId: string;
  x: number;
  y: number;
  onClose: () => void;
}) {
  const table = useFloorEditor((s) => s.doc.tables[tableId]);
  const updateTable = useFloorEditor((s) => s.updateTable);
  const setSelection = useFloorEditor((s) => s.setSelection);
  const deleteSelection = useFloorEditor((s) => s.deleteSelection);
  const rotateSelection = useFloorEditor((s) => s.rotateSelection);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    ref.current?.querySelector("button")?.focus();
  }, []);

  if (!table) return null;

  const act = (fn: () => void) => {
    setSelection([tableId]);
    fn();
    onClose();
  };

  return (
    <>
      <div className="fp-sheet-scrim" onPointerDown={onClose} />
      <div
        ref={ref}
        className="fp-sheet"
        style={{ left: x, top: y }}
        role="menu"
        aria-label={`Actions for table ${table.label}`}
        onKeyDown={(e) => e.key === "Escape" && onClose()}
      >
        <button
          type="button"
          role="menuitem"
          className="fp-sheet-item"
          onClick={() => act(() => rotateSelection(15))}
        >
          Rotate 15°
        </button>
        <button
          type="button"
          role="menuitem"
          className="fp-sheet-item"
          onClick={() =>
            act(() =>
              updateTable(tableId, { onlineBookable: !table.onlineBookable })
            )
          }
        >
          {table.onlineBookable ? "Stop online booking" : "Allow online booking"}
        </button>
        <button
          type="button"
          role="menuitem"
          className="fp-sheet-item fp-sheet-danger"
          onClick={() => act(deleteSelection)}
        >
          Delete table {table.label}
        </button>
      </div>
    </>
  );
}

/**
 * Warn before losing unsaved work.
 *
 * `beforeunload` covers reloads and closes. Nav-rail clicks are caught in the
 * capture phase so the plugin can guard them without editing NavRail, which
 * the registry convention forbids.
 */
function useDirtyGuard(dirty: boolean): void {
  useEffect(() => {
    if (!dirty) return;

    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };

    const onCapturedClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      const rail = target?.closest?.(".rail");
      if (!rail) return;
      const ok = window.confirm(
        "You have unsaved floor plan changes. Leave without saving?"
      );
      if (!ok) {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onCapturedClick, true);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onCapturedClick, true);
    };
  }, [dirty]);
}

/** Arrows nudge, shift-arrows nudge ten, delete removes, cmd-z undoes. */
function useEditorKeyboard(): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }

      const store = useFloorEditor.getState();
      const mod = e.metaKey || e.ctrlKey;

      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) store.redo();
        else store.undo();
        return;
      }

      if (e.key === "Escape") {
        store.cancelInteraction();
        store.clearSelection();
        return;
      }

      if (store.selection.length === 0) return;

      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        store.deleteSelection();
        return;
      }

      const step = e.shiftKey ? NUDGE_LARGE : NUDGE_SMALL;
      const deltas: Record<string, [number, number]> = {
        ArrowLeft: [-step, 0],
        ArrowRight: [step, 0],
        ArrowUp: [0, -step],
        ArrowDown: [0, step],
      };
      const delta = deltas[e.key];
      if (delta) {
        e.preventDefault();
        store.nudgeSelection(delta[0], delta[1]);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
