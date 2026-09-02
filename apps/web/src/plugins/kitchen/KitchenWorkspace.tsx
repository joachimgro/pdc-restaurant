"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { fetchCapabilities, type Capabilities } from "@/lib/api/capabilities";
import type {
  KitchenMenuCategory,
  KitchenMenuChoiceGroup,
  KitchenTicket,
} from "./api/kitchen-types";
import {
  createKitchenMenuCategory,
  createKitchenMenuItem,
  deleteKitchenMenuItem,
  fetchKitchenMenu,
  fetchKitchenTickets,
  importKitchenMenu,
  parseMenuImage,
  setMenuItemAvailability,
  updateKitchenMenuCategory,
  updateKitchenMenuItem,
  updateKitchenTicketStatus,
} from "./api/kitchen";
import { KITCHEN_LATE_MINUTES } from "./constants";
import { MenuStationSorter } from "./MenuStationSorter";
import {
  MENU_STATIONS,
  normalizeStation,
  stationLabel,
  stationMatches,
  type MenuStationId,
} from "./stations";
import "./kitchen.css";

type KitchenMode = "chef" | "ready" | "menu";

const MODES: { id: KitchenMode | "order"; label: string; hint?: string }[] = [
  { id: "order", label: "Order" },
  { id: "chef", label: "Kitchen" },
  { id: "menu", label: "Menu", hint: "Edit / import" },
];

/** Industry KDS aging: fresh → warning → late (Toast/Square-style). */
const AGE_WARN_MS = 8 * 60_000;
const AGE_LATE_MS = KITCHEN_LATE_MINUTES * 60_000;

const SERVE_MODE_LABELS: Record<string, string> = {
  courses: "In courses",
  as_it_comes: "As it comes",
  all_together: "All together",
};

const COURSE_ORDER = ["starter", "main", "dessert"] as const;

function serveModeLabel(mode: string | null | undefined): string | null {
  if (!mode) return null;
  return SERVE_MODE_LABELS[mode] ?? mode;
}

function groupTicketItemsByCourse(
  items: KitchenTicket["items"]
): { course: string | null; label: string | null; items: KitchenTicket["items"] }[] {
  const buckets = new Map<string, KitchenTicket["items"]>();
  for (const item of items) {
    const key = item.course ?? "";
    const list = buckets.get(key) ?? [];
    list.push(item);
    buckets.set(key, list);
  }
  const groups: {
    course: string | null;
    label: string | null;
    items: KitchenTicket["items"];
  }[] = [];
  for (const course of COURSE_ORDER) {
    const list = buckets.get(course);
    if (list?.length) {
      groups.push({
        course,
        label: course.toUpperCase(),
        items: list,
      });
      buckets.delete(course);
    }
  }
  for (const [key, list] of buckets) {
    if (!list.length) continue;
    groups.push({
      course: key || null,
      label: key ? key.toUpperCase() : null,
      items: list,
    });
  }
  return groups;
}

function ticketAgeMs(ticket: KitchenTicket, now: number): number {
  const start = Date.parse(ticket.startedAt ?? ticket.createdAt);
  if (Number.isNaN(start)) return 0;
  return Math.max(0, now - start);
}

function ageBand(ms: number): "fresh" | "warn" | "late" {
  if (ms >= AGE_LATE_MS) return "late";
  if (ms >= AGE_WARN_MS) return "warn";
  return "fresh";
}

function formatElapsed(ms: number): string {
  const mins = Math.floor(ms / 60_000);
  const secs = Math.floor((ms % 60_000) / 1000);
  if (mins >= 60) {
    const h = Math.floor(mins / 60);
    return `${h}h ${mins % 60}m`;
  }
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

export function KitchenWorkspace() {
  const router = useRouter();
  const [caps, setCaps] = useState<Capabilities | null>(null);
  const [mode, setMode] = useState<KitchenMode>("chef");
  const [menu, setMenu] = useState<KitchenMenuCategory[]>([]);
  const [tickets, setTickets] = useState<KitchenTicket[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [lastBumped, setLastBumped] = useState<{
    id: string;
    prev: "in_progress" | "ready" | "served" | "void" | "new";
  } | null>(null);
  const [availUndo, setAvailUndo] = useState<{
    menuItemId: string;
    name: string;
  } | null>(null);

  useEffect(() => {
    void fetchCapabilities().then(setCaps);
  }, []);

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);

  const loadBoard = useCallback(async () => {
    const result = await fetchKitchenTickets();
    if (result.ok) setTickets(result.data.tickets);
  }, []);

  const loadMenuOnly = useCallback(async () => {
    const menuResult = await fetchKitchenMenu();
    if (menuResult.ok) {
      setMenu(menuResult.data.categories);
    }
    return menuResult;
  }, []);

  const load = useCallback(async () => {
    setStatus("loading");
    setError(null);
    const [menuResult, ticketResult] = await Promise.all([
      fetchKitchenMenu(),
      fetchKitchenTickets(),
    ]);
    if (!menuResult.ok) {
      setStatus("error");
      setError(menuResult.error);
      return;
    }
    if (!ticketResult.ok) {
      setStatus("error");
      setError(ticketResult.error);
      return;
    }
    setMenu(menuResult.data.categories);
    setTickets(ticketResult.data.tickets);
    setStatus("ready");
  }, []);

  useEffect(() => {
    if (caps?.kitchen) void load();
  }, [caps?.kitchen, load]);

  useEffect(() => {
    if (!caps?.kitchen || status !== "ready") return;
    const timer = window.setInterval(() => void loadBoard(), 8_000);
    return () => window.clearInterval(timer);
  }, [caps?.kitchen, status, loadBoard]);

  // Expo board path retained unused (Phase 4 merge into Kitchen).
  const readyTickets = useMemo(() => {
    const list = tickets.filter((t) => t.status === "ready");
    return [...list].sort(
      (a, b) => ticketAgeMs(b, now) - ticketAgeMs(a, now)
    );
  }, [tickets, now]);

  const kitchenTickets = useMemo(() => {
    const list = tickets.filter(
      (t) =>
        t.status === "new" ||
        t.status === "in_progress" ||
        t.status === "ready"
    );
    return [...list].sort(
      (a, b) => ticketAgeMs(b, now) - ticketAgeMs(a, now)
    );
  }, [tickets, now]);

  const lateCount = useMemo(
    () =>
      kitchenTickets.filter((t) => ageBand(ticketAgeMs(t, now)) === "late")
        .length,
    [kitchenTickets, now]
  );

  async function setTicketStatus(
    id: string,
    next: "in_progress" | "ready" | "served" | "void"
  ) {
    const prev = tickets.find((t) => t.id === id);
    setBusy(true);
    const result = await updateKitchenTicketStatus(id, next);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    if (prev) {
      setLastBumped({
        id,
        prev: prev.status as "in_progress" | "ready" | "served" | "void" | "new",
      });
    }
    await loadBoard();
  }

  async function undoBump() {
    if (!lastBumped) return;
    const restore =
      lastBumped.prev === "new" || lastBumped.prev === "in_progress"
        ? "in_progress"
        : lastBumped.prev === "ready"
          ? "ready"
          : null;
    if (!restore) {
      setLastBumped(null);
      return;
    }
    setBusy(true);
    await updateKitchenTicketStatus(lastBumped.id, restore);
    setBusy(false);
    setLastBumped(null);
    await loadBoard();
  }

  async function eightySixItem(menuItemId: string | null, name: string) {
    if (!menuItemId) return;
    setBusy(true);
    setError(null);
    const result = await setMenuItemAvailability(menuItemId, false);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setAvailUndo({ menuItemId, name });
    await loadMenuOnly();
  }

  async function undoEightySix() {
    if (!availUndo) return;
    setBusy(true);
    const result = await setMenuItemAvailability(availUndo.menuItemId, true);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setAvailUndo(null);
    await loadMenuOnly();
  }

  if (!caps) {
    return <div className="kt-loading">Loading…</div>;
  }

  if (!caps.kitchen) {
    return (
      <div className="kt-root kt-panel">
        <p>Kitchen module is not enabled for this venue.</p>
      </div>
    );
  }

  if (status === "loading") {
    return <div className="kt-loading">Loading kitchen</div>;
  }

  if (status === "error") {
    return (
      <div className="kt-loading">
        <p>{error}</p>
        <button type="button" className="kt-btn" onClick={() => void load()}>
          Try again
        </button>
      </div>
    );
  }

  return (
    <div className="kt-root" style={{ gridColumn: "2 / -1" }}>
      <div className="kt-panel kt-mode-bar">
        <div
          className="kt-mode-segment kt-mode-segment-3"
          role="tablist"
          aria-label="Kitchen mode"
        >
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              role="tab"
              aria-selected={m.id === "order" ? false : mode === m.id}
              className={`kt-mode-btn${
                m.id !== "order" && mode === m.id ? " is-active" : ""
              }`}
              onClick={() => {
                if (m.id === "order") {
                  router.push("/order");
                  return;
                }
                setMode(m.id);
              }}
            >
              <span className="kt-mode-label">{m.label}</span>
              {m.hint ? <span className="kt-mode-hint">{m.hint}</span> : null}
            </button>
          ))}
        </div>
        <div className="kt-board-meta">
          {lateCount > 0 && (
            <span
              className="kt-late-pill"
              title={`Tickets over ${KITCHEN_LATE_MINUTES} minutes`}
            >
              {lateCount} late
            </span>
          )}
          {lastBumped && (
            <button
              type="button"
              className="kt-btn kt-btn-ghost"
              disabled={busy}
              onClick={() => void undoBump()}
            >
              Undo bump
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="kt-error kt-panel" role="alert">
          {error}
          <button
            type="button"
            className="kt-icon-btn"
            onClick={() => setError(null)}
          >
            ×
          </button>
        </div>
      )}

      {availUndo && (
        <div className="kt-undo-toast kt-panel" role="status">
          <span>86’d {availUndo.name}</span>
          <button
            type="button"
            className="kt-btn kt-btn-ghost"
            disabled={busy}
            onClick={() => void undoEightySix()}
          >
            Undo
          </button>
          <button
            type="button"
            className="kt-icon-btn"
            onClick={() => setAvailUndo(null)}
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      )}

      <div className="kt-panel kt-body">
        {mode === "chef" && (
          <TicketBoard
            title="Kitchen"
            empty="Nothing on the board — send an order from Order."
            tickets={kitchenTickets}
            now={now}
            busy={busy}
            lateMinutes={KITCHEN_LATE_MINUTES}
            onBump={(id, s) => void setTicketStatus(id, s)}
            onVoid={(id) => void setTicketStatus(id, "void")}
            onEightySix={(menuItemId, name) =>
              void eightySixItem(menuItemId, name)
            }
          />
        )}
        {/* Expo tab hidden; dead path kept for reference */}
        {mode === "ready" && (
          <TicketBoard
            title="Kitchen"
            empty="Nothing ready."
            tickets={readyTickets}
            now={now}
            busy={busy}
            lateMinutes={KITCHEN_LATE_MINUTES}
            onBump={(id, s) => void setTicketStatus(id, s)}
            onVoid={(id) => void setTicketStatus(id, "void")}
            onEightySix={(menuItemId, name) =>
              void eightySixItem(menuItemId, name)
            }
          />
        )}
        {mode === "menu" && (
          <MenuEditor
            menu={menu}
            busy={busy}
            setBusy={setBusy}
            onError={setError}
            onMenuUpdate={setMenu}
            onChanged={async () => {
              await loadMenuOnly();
            }}
          />
        )}
      </div>
    </div>
  );
}

/** Downscale/compress for Workers AI vision (faster + under size caps). */
async function prepareMenuImage(file: File): Promise<Blob> {
  if (!file.type.startsWith("image/")) {
    throw new Error("Please choose a photo or image file");
  }
  const bitmap = await createImageBitmap(file);
  const maxEdge = 1280;
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    return file;
  }
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob((b) => resolve(b), "image/jpeg", 0.82)
  );
  return blob ?? file;
}

function MenuEditor({
  menu,
  busy,
  setBusy,
  onError,
  onChanged,
  onMenuUpdate,
}: {
  menu: KitchenMenuCategory[];
  busy: boolean;
  setBusy: (v: boolean) => void;
  onError: (msg: string | null) => void;
  onChanged: () => Promise<void>;
  onMenuUpdate: (categories: KitchenMenuCategory[]) => void;
}) {
  const [importText, setImportText] = useState("");
  const [importMode, setImportMode] = useState<"merge" | "replace">("merge");
  const [editStation, setEditStation] = useState<MenuStationId>("restaurant");
  const [catName, setCatName] = useState("");
  const [itemName, setItemName] = useState("");
  const [itemCategoryId, setItemCategoryId] = useState("");
  const [itemPrice, setItemPrice] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const categoriesForStation = useMemo(
    () => menu.filter((c) => stationMatches(c.station, editStation)),
    [menu, editStation]
  );

  const menuByStation = useMemo(() => {
    return MENU_STATIONS.map((s) => ({
      ...s,
      categories: menu
        .filter((c) => stationMatches(c.station, s.id))
        .map((c) => ({
          ...c,
          items: c.items.filter((i) => stationMatches(i.station, s.id)),
        })),
    }));
  }, [menu]);

  useEffect(() => {
    if (
      !itemCategoryId ||
      !categoriesForStation.some((c) => c.id === itemCategoryId)
    ) {
      setItemCategoryId(categoriesForStation[0]?.id ?? "");
    }
  }, [categoriesForStation, itemCategoryId]);

  async function runImport() {
    if (!importText.trim()) return;
    setBusy(true);
    setNotice(null);
    onError(null);
    const result = await importKitchenMenu({
      mode: importMode,
      text: importText,
    });
    setBusy(false);
    if (!result.ok) {
      onError(result.error);
      return;
    }
    setNotice(
      `Imported ${result.data.importedItems} items in ${result.data.importedCategories} categories`
    );
    setImportText("");
    await onChanged();
  }

  async function onPickPhoto(file: File | null) {
    if (!file) return;
    setScanning(true);
    setNotice(null);
    onError(null);
    try {
      const prepared = await prepareMenuImage(file);
      const result = await parseMenuImage(prepared);
      if (!result.ok) {
        onError(result.error);
        return;
      }
      setImportText(result.data.text);
      setNotice(
        `Read ${result.data.itemCount} items in ${result.data.categoryCount} categories — review below, then Import`
      );
    } catch (err) {
      onError(err instanceof Error ? err.message : "Could not read that photo");
    } finally {
      setScanning(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function addCategory() {
    if (!catName.trim()) return;
    setBusy(true);
    onError(null);
    const result = await createKitchenMenuCategory({
      name: catName.trim(),
      station: editStation,
    });
    setBusy(false);
    if (!result.ok) {
      onError(result.error);
      return;
    }
    setCatName("");
    setItemCategoryId(result.data.category.id);
    await onChanged();
  }

  async function addItem() {
    if (!itemName.trim() || !itemCategoryId) return;
    const pounds = Number(itemPrice);
    const pricePence =
      itemPrice.trim() === "" || Number.isNaN(pounds)
        ? 0
        : Math.round(pounds * 100);
    setBusy(true);
    onError(null);
    const result = await createKitchenMenuItem({
      categoryId: itemCategoryId,
      name: itemName.trim(),
      pricePence,
      station: editStation,
    });
    setBusy(false);
    if (!result.ok) {
      onError(result.error);
      return;
    }
    setItemName("");
    setItemPrice("");
    await onChanged();
  }

  async function removeItem(id: string, name: string) {
    if (!window.confirm(`Remove “${name}” from the menu?`)) return;
    setBusy(true);
    onError(null);
    const result = await deleteKitchenMenuItem(id);
    setBusy(false);
    if (!result.ok) {
      onError(result.error);
      return;
    }
    await onChanged();
  }

  async function patchCategory(
    id: string,
    patch: { station?: string; defaultCourse?: string | null }
  ) {
    setBusy(true);
    onError(null);
    const result = await updateKitchenMenuCategory(id, patch);
    setBusy(false);
    if (!result.ok) {
      onError(result.error);
      return;
    }
    await onChanged();
  }

  async function patchItemAvailability(id: string, available: boolean) {
    setBusy(true);
    onError(null);
    const result = await setMenuItemAvailability(id, available);
    setBusy(false);
    if (!result.ok) {
      onError(result.error);
      return;
    }
    await onChanged();
  }

  async function patchItemChoices(
    id: string,
    choices: KitchenMenuChoiceGroup[] | null
  ) {
    setBusy(true);
    onError(null);
    const result = await updateKitchenMenuItem(id, { choices });
    setBusy(false);
    if (!result.ok) {
      onError(result.error);
      return;
    }
    await onChanged();
  }

  return (
    <div className="kt-menu-editor">
      <section className="kt-editor-block">
        <h2 className="kt-board-title">Import menu</h2>
        <p className="kt-editor-help">
          Photo a printed menu, or paste text with <code>## Mains</code> headings
          and one dish per line. Review AI results before importing.
        </p>

        <div className="kt-editor-row">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="kt-file-input"
            aria-label="Upload menu photo"
            disabled={busy || scanning}
            onChange={(e) => void onPickPhoto(e.target.files?.[0] ?? null)}
          />
          <button
            type="button"
            className="kt-btn kt-btn-fire"
            disabled={busy || scanning}
            onClick={() => fileInputRef.current?.click()}
          >
            {scanning ? "Reading photo…" : "Upload menu photo"}
          </button>
        </div>

        <textarea
          className="kt-textarea"
          rows={10}
          value={importText}
          onChange={(e) => setImportText(e.target.value)}
          placeholder={`## Starters\nSoup - £6.50\n\n## Mains\nHouse Burger - £16.50\n\n## Coffee | station=cafe\nFlat White - £3.50\n\n## Cocktails | station=bar\nNegroni - £9.50`}
        />
        <div className="kt-editor-row">
          <label className="kt-radio">
            <input
              type="radio"
              checked={importMode === "merge"}
              onChange={() => setImportMode("merge")}
            />
            Merge (keep existing)
          </label>
          <label className="kt-radio">
            <input
              type="radio"
              checked={importMode === "replace"}
              onChange={() => setImportMode("replace")}
            />
            Replace all
          </label>
          <button
            type="button"
            className="kt-btn kt-btn-fire"
            disabled={busy || !importText.trim()}
            onClick={() => void runImport()}
          >
            Import
          </button>
        </div>
        {notice && <p className="kt-notice">{notice}</p>}
      </section>

      <section className="kt-editor-block">
        <h2 className="kt-board-title">Add to menu</h2>
        <p className="kt-editor-help">
          Pick where it belongs first — Restaurant, Cafe, or Bar — then add a
          category and items for that area.
        </p>

        <div className="kt-station-bar" role="tablist" aria-label="Menu area">
          {MENU_STATIONS.map((s) => (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={editStation === s.id}
              className={`kt-station-chip${editStation === s.id ? " is-active" : ""}`}
              onClick={() => setEditStation(s.id)}
            >
              <span className="kt-station-chip-label">{s.label}</span>
              <span className="kt-station-chip-hint">{s.hint}</span>
            </button>
          ))}
        </div>

        <div className="kt-add-card">
          <h3 className="kt-add-card-title">
            New category · {stationLabel(editStation)}
          </h3>
          <div className="kt-editor-row">
            <input
              className="kt-input"
              placeholder={`e.g. ${editStation === "bar" ? "Cocktails" : editStation === "cafe" ? "Pastries" : "Mains"}`}
              value={catName}
              onChange={(e) => setCatName(e.target.value)}
            />
            <button
              type="button"
              className="kt-btn"
              disabled={busy || !catName.trim()}
              onClick={() => void addCategory()}
            >
              Add category
            </button>
          </div>
        </div>

        <div className="kt-add-card">
          <h3 className="kt-add-card-title">
            New item · {stationLabel(editStation)}
          </h3>
          {categoriesForStation.length === 0 ? (
            <p className="kt-editor-help">
              Add a category for {stationLabel(editStation).toLowerCase()} first.
            </p>
          ) : (
            <div className="kt-editor-row">
              <select
                className="kt-input"
                value={itemCategoryId}
                onChange={(e) => setItemCategoryId(e.target.value)}
              >
                {categoriesForStation.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <input
                className="kt-input"
                placeholder="Item name"
                value={itemName}
                onChange={(e) => setItemName(e.target.value)}
              />
              <input
                className="kt-input kt-input-price"
                placeholder="£"
                inputMode="decimal"
                value={itemPrice}
                onChange={(e) => setItemPrice(e.target.value)}
              />
              <button
                type="button"
                className="kt-btn"
                disabled={busy || !itemName.trim() || !itemCategoryId}
                onClick={() => void addItem()}
              >
                Add item
              </button>
            </div>
          )}
        </div>
      </section>

      <section className="kt-editor-block">
        <h2 className="kt-board-title">Current menu</h2>
        <p className="kt-editor-help">
          Drag the ⋮⋮ handle to reorder. Set station and default course per
          category; toggle Available / 86’d and edit choices per item.
        </p>
        {menu.length === 0 ? (
          <p className="kt-empty">Nothing on the menu yet.</p>
        ) : (
          <div className="kt-editor-stations">
            {menuByStation.map((area) => (
              <div key={area.id} className="kt-editor-station-block">
                <h3 className="kt-editor-station-title">
                  {area.label}
                  <span className="kt-editor-station-hint">{area.hint}</span>
                </h3>
                <MenuStationSorter
                  station={area.id}
                  categories={area.categories}
                  busy={busy}
                  onError={onError}
                  onRemoveItem={(id, name) => void removeItem(id, name)}
                  onUpdateCategory={(id, patch) => void patchCategory(id, patch)}
                  onToggleAvailability={(id, available) =>
                    void patchItemAvailability(id, available)
                  }
                  onSaveChoices={(id, choices) =>
                    void patchItemChoices(id, choices)
                  }
                  onOptimistic={(stationCats) => {
                    const other = menu.filter(
                      (c) => !stationMatches(c.station, area.id)
                    );
                    onMenuUpdate([...other, ...stationCats]);
                  }}
                  onServerMenu={onMenuUpdate}
                />
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function TicketBoard({
  title,
  empty,
  tickets,
  now,
  busy,
  lateMinutes,
  onBump,
  onVoid,
  onEightySix,
}: {
  title: string;
  empty: string;
  tickets: KitchenTicket[];
  now: number;
  busy: boolean;
  lateMinutes: number;
  onBump: (id: string, status: "in_progress" | "ready" | "served") => void;
  onVoid: (id: string) => void;
  onEightySix: (menuItemId: string | null, name: string) => void;
}) {
  return (
    <div className="kt-board">
      <header className="kt-board-head">
        <h2 className="kt-board-title">
          {title}
          <span className="kt-board-count fp-num">{tickets.length}</span>
        </h2>
        <p className="kt-board-legend">
          <span className="kt-dot kt-dot-fresh" /> Fresh
          <span className="kt-dot kt-dot-warn" /> 8m+
          <span className="kt-dot kt-dot-late" /> {lateMinutes}m+
        </p>
      </header>
      {tickets.length === 0 ? (
        <p className="kt-empty">{empty}</p>
      ) : (
        <div className="kt-ticket-grid">
          {tickets.map((t) => {
            const age = ticketAgeMs(t, now);
            const band = ageBand(age);
            const modeLabel = serveModeLabel(t.serveMode);
            const isBar = normalizeStation(t.station) === "bar";
            const courseGroups = groupTicketItemsByCourse(t.items);
            const showCourseHeaders =
              courseGroups.length > 1 ||
              courseGroups.some((g) => g.course != null);
            const canStart = t.status === "new";
            const canReady =
              t.status === "new" || t.status === "in_progress";
            const canServed = t.status === "ready";
            return (
              <article
                key={t.id}
                className={`kt-ticket kt-age-${band} kt-ticket-${t.status}`}
              >
                <div className="kt-ticket-body">
                  <header className="kt-ticket-head">
                    <span className="kt-ticket-table-wrap">
                      <span className="kt-ticket-table">
                        {t.tableLabel ? `T${t.tableLabel}` : "WALK"}
                      </span>
                      {modeLabel && (
                        <span className="kt-serve-badge">{modeLabel}</span>
                      )}
                      {isBar && (
                        <span className="kt-station-chip-inline">Bar</span>
                      )}
                    </span>
                    <span className={`kt-ticket-timer fp-num kt-timer-${band}`}>
                      {formatElapsed(age)}
                    </span>
                  </header>
                  <ul className="kt-ticket-items">
                    {courseGroups.map((group, gi) => (
                      <li
                        key={`${t.id}-g-${group.course ?? "x"}-${gi}`}
                        className="kt-course-group"
                      >
                        {showCourseHeaders && group.label && (
                          <div className="kt-course-divider">{group.label}</div>
                        )}
                        <ul className="kt-course-items">
                          {group.items.map((item) => (
                            <li key={item.id} className="kt-ticket-line">
                              <span className="kt-qty fp-num">{item.qty}</span>
                              <span className="kt-item-body">
                                <span className="kt-item-name">{item.name}</span>
                                {item.notes ? (
                                  <span className="kt-item-notes">
                                    {item.notes}
                                  </span>
                                ) : null}
                              </span>
                              {item.menuItemId ? (
                                <button
                                  type="button"
                                  className="kt-86-btn"
                                  disabled={busy}
                                  onClick={() =>
                                    onEightySix(item.menuItemId, item.name)
                                  }
                                  aria-label={`86 ${item.name}`}
                                >
                                  86
                                </button>
                              ) : null}
                            </li>
                          ))}
                        </ul>
                      </li>
                    ))}
                  </ul>
                  {t.notes && <p className="kt-ticket-mods">{t.notes}</p>}
                  <div className="kt-ticket-actions">
                    {canStart && (
                      <button
                        type="button"
                        className="kt-bump-btn"
                        disabled={busy}
                        onClick={() => onBump(t.id, "in_progress")}
                      >
                        Start
                      </button>
                    )}
                    {canReady && (
                      <button
                        type="button"
                        className="kt-bump-btn kt-bump-ready"
                        disabled={busy}
                        onClick={() => onBump(t.id, "ready")}
                      >
                        Ready
                      </button>
                    )}
                    {canServed && (
                      <button
                        type="button"
                        className="kt-bump-btn kt-bump-served"
                        disabled={busy}
                        onClick={() => onBump(t.id, "served")}
                      >
                        Served
                      </button>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  className="kt-void-btn"
                  disabled={busy}
                  onClick={() => onVoid(t.id)}
                  aria-label="Void ticket"
                >
                  Void
                </button>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
