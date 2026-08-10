"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchCapabilities, type Capabilities } from "@/lib/api/capabilities";
import type { KitchenMenuCategory, KitchenTicket } from "./api/kitchen-types";
import {
  createKitchenMenuCategory,
  createKitchenMenuItem,
  createKitchenTicket,
  deleteKitchenMenuItem,
  fetchKitchenMenu,
  fetchKitchenTickets,
  importKitchenMenu,
  parseMenuImage,
  updateKitchenTicketStatus,
} from "./api/kitchen";
import { MenuStationSorter } from "./MenuStationSorter";
import {
  MENU_STATIONS,
  normalizeStation,
  stationLabel,
  stationMatches,
  type MenuStationId,
} from "./stations";
import "./kitchen.css";

type KitchenMode = "submit" | "chef" | "ready" | "menu";

const MODES: { id: KitchenMode; label: string; hint: string }[] = [
  { id: "submit", label: "Fire", hint: "Send tickets" },
  { id: "chef", label: "Cook", hint: "Active board" },
  { id: "ready", label: "Expo", hint: "Ready to run" },
  { id: "menu", label: "Menu", hint: "Edit / import" },
];

/** Industry KDS aging: fresh → warning → late (Toast/Square-style). */
const AGE_WARN_MS = 8 * 60_000;
const AGE_LATE_MS = 15 * 60_000;

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
  const [caps, setCaps] = useState<Capabilities | null>(null);
  const [mode, setMode] = useState<KitchenMode>("submit");
  const [menu, setMenu] = useState<KitchenMenuCategory[]>([]);
  const [tickets, setTickets] = useState<KitchenTicket[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [tableLabel, setTableLabel] = useState("");
  const [station, setStation] = useState<MenuStationId>("restaurant");
  const [cart, setCart] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [lastBumped, setLastBumped] = useState<{
    id: string;
    prev: "in_progress" | "ready" | "served" | "void" | "new";
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

  const menuForStation = useMemo(
    () =>
      menu
        .map((cat) => ({
          ...cat,
          station: normalizeStation(cat.station),
          items: cat.items.filter((i) => stationMatches(i.station, station)),
        }))
        .filter(
          (cat) =>
            cat.items.length > 0 || stationMatches(cat.station, station)
        )
        .map((cat) =>
          // Keep categories that belong to this area even if empty (editing context);
          // Fire only needs ones with items — filter empty for submit via items length.
          cat
        )
        .filter((cat) => cat.items.length > 0),
    [menu, station]
  );

  const stationCounts = useMemo(() => {
    const counts: Record<MenuStationId, number> = {
      restaurant: 0,
      cafe: 0,
      bar: 0,
    };
    for (const cat of menu) {
      for (const item of cat.items) {
        counts[normalizeStation(item.station)] += 1;
      }
    }
    return counts;
  }, [menu]);

  const chefTickets = useMemo(() => {
    const list = tickets.filter(
      (t) => t.status === "new" || t.status === "in_progress"
    );
    return [...list].sort(
      (a, b) => ticketAgeMs(b, now) - ticketAgeMs(a, now)
    );
  }, [tickets, now]);

  const readyTickets = useMemo(() => {
    const list = tickets.filter((t) => t.status === "ready");
    return [...list].sort(
      (a, b) => ticketAgeMs(b, now) - ticketAgeMs(a, now)
    );
  }, [tickets, now]);

  const lateCount = useMemo(
    () =>
      [...chefTickets, ...readyTickets].filter(
        (t) => ageBand(ticketAgeMs(t, now)) === "late"
      ).length,
    [chefTickets, readyTickets, now]
  );

  async function submitTicket() {
    const items = Object.entries(cart)
      .filter(([, qty]) => qty > 0)
      .map(([menuItemId, qty]) => ({ menuItemId, qty }));
    if (items.length === 0) return;

    setBusy(true);
    const result = await createKitchenTicket({
      station,
      tableLabel: tableLabel.trim() || undefined,
      items,
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setCart({});
    setTableLabel("");
    await loadBoard();
    setMode("chef");
  }

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
        <div className="kt-mode-segment kt-mode-segment-4" role="tablist" aria-label="Kitchen mode">
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              role="tab"
              aria-selected={mode === m.id}
              className={`kt-mode-btn${mode === m.id ? " is-active" : ""}`}
              onClick={() => setMode(m.id)}
            >
              <span className="kt-mode-label">{m.label}</span>
              <span className="kt-mode-hint">{m.hint}</span>
            </button>
          ))}
        </div>
        <div className="kt-board-meta">
          {lateCount > 0 && (
            <span className="kt-late-pill" title="Tickets over 15 minutes">
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
          <button type="button" className="kt-icon-btn" onClick={() => setError(null)}>
            ×
          </button>
        </div>
      )}

      <div className="kt-panel kt-body">
        {mode === "submit" && (
          <SubmitMode
            station={station}
            onStation={setStation}
            stationCounts={stationCounts}
            tableLabel={tableLabel}
            onTableLabel={setTableLabel}
            menu={menuForStation}
            cart={cart}
            onCart={setCart}
            busy={busy}
            onSubmit={() => void submitTicket()}
            onOpenMenu={() => setMode("menu")}
          />
        )}
        {mode === "chef" && (
          <TicketBoard
            title="Cook board"
            empty="Nothing firing — fire a ticket or wait for FOH."
            tickets={chefTickets}
            now={now}
            busy={busy}
            bumpLabel={(t) =>
              t.status === "new" ? "Start" : "Bump ready"
            }
            bumpStatus={(t) =>
              t.status === "new" ? "in_progress" : "ready"
            }
            onBump={(id, s) => void setTicketStatus(id, s)}
            onVoid={(id) => void setTicketStatus(id, "void")}
          />
        )}
        {mode === "ready" && (
          <TicketBoard
            title="Expo — ready to run"
            empty="Nothing ready. Tickets land here when the line bumps them."
            tickets={readyTickets}
            now={now}
            busy={busy}
            bumpLabel={() => "Served"}
            bumpStatus={() => "served"}
            onBump={(id, s) => void setTicketStatus(id, s)}
            onVoid={(id) => void setTicketStatus(id, "void")}
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

function adjustCart(
  cart: Record<string, number>,
  itemId: string,
  delta: number
): Record<string, number> {
  const next = { ...cart };
  const qty = (next[itemId] ?? 0) + delta;
  if (qty <= 0) delete next[itemId];
  else next[itemId] = qty;
  return next;
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

function SubmitMode({
  station,
  onStation,
  stationCounts,
  tableLabel,
  onTableLabel,
  menu,
  cart,
  onCart,
  busy,
  onSubmit,
  onOpenMenu,
}: {
  station: MenuStationId;
  onStation: (s: MenuStationId) => void;
  stationCounts: Record<MenuStationId, number>;
  tableLabel: string;
  onTableLabel: (v: string) => void;
  menu: KitchenMenuCategory[];
  cart: Record<string, number>;
  onCart: (c: Record<string, number>) => void;
  busy: boolean;
  onSubmit: () => void;
  onOpenMenu: () => void;
}) {
  const cartCount = Object.values(cart).reduce((a, b) => a + b, 0);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const skipClickRef = useRef(false);
  const lastRemoveAtRef = useRef(0);

  useEffect(() => {
    if (menu.length === 0) {
      setCategoryId(null);
      return;
    }
    if (!categoryId || !menu.some((c) => c.id === categoryId)) {
      setCategoryId(menu[0].id);
    }
  }, [menu, categoryId]);

  const activeIndex = Math.max(
    0,
    menu.findIndex((c) => c.id === categoryId)
  );
  const active = menu[activeIndex] ?? null;

  function cycle(delta: number) {
    if (menu.length === 0) return;
    const next = (activeIndex + delta + menu.length) % menu.length;
    setCategoryId(menu[next].id);
  }

  function addItem(id: string) {
    onCart(adjustCart(cart, id, 1));
  }

  /** Right-click / two-finger can fire multiple DOM events — only one remove. */
  function removeItem(id: string) {
    const now = Date.now();
    if (now - lastRemoveAtRef.current < 280) return;
    lastRemoveAtRef.current = now;
    skipClickRef.current = true;
    onCart(adjustCart(cart, id, -1));
  }

  return (
    <div className="kt-submit">
      <div className="kt-submit-meta">
        <label className="kt-field">
          <span>Table</span>
          <input
            className="kt-input"
            value={tableLabel}
            onChange={(e) => onTableLabel(e.target.value)}
            placeholder="e.g. 12"
            autoComplete="off"
          />
        </label>
        <button type="button" className="kt-btn kt-btn-ghost" onClick={onOpenMenu}>
          Edit menu
        </button>
      </div>

      <div className="kt-station-bar" role="tablist" aria-label="Service area">
        {MENU_STATIONS.map((s) => (
          <button
            key={s.id}
            type="button"
            role="tab"
            aria-selected={station === s.id}
            className={`kt-station-chip${station === s.id ? " is-active" : ""}`}
            onClick={() => onStation(s.id)}
          >
            <span className="kt-station-chip-label">{s.label}</span>
            <span className="kt-station-chip-hint">{s.hint}</span>
            <span className="kt-cat-count fp-num">{stationCounts[s.id]}</span>
          </button>
        ))}
      </div>

      {menu.length === 0 ? (
        <div className="kt-empty-menu">
          <p>
            No {stationLabel(station).toLowerCase()} items yet. Add them under
            Menu, tagged for this area.
          </p>
          <button type="button" className="kt-btn kt-btn-fire" onClick={onOpenMenu}>
            Set up menu
          </button>
        </div>
      ) : (
        <>
          <div className="kt-cat-bar">
            <button
              type="button"
              className="kt-cat-nav"
              aria-label="Previous category"
              onClick={() => cycle(-1)}
            >
              ‹
            </button>
            <div className="kt-cat-chips" role="tablist" aria-label="Menu categories">
              {menu.map((cat) => (
                <button
                  key={cat.id}
                  type="button"
                  role="tab"
                  aria-selected={cat.id === categoryId}
                  className={`kt-cat-chip${cat.id === categoryId ? " is-active" : ""}`}
                  onClick={() => setCategoryId(cat.id)}
                >
                  {cat.name}
                  <span className="kt-cat-count fp-num">{cat.items.length}</span>
                </button>
              ))}
            </div>
            <button
              type="button"
              className="kt-cat-nav"
              aria-label="Next category"
              onClick={() => cycle(1)}
            >
              ›
            </button>
          </div>

          <p className="kt-qty-hint">
            Tap to add · right-click or two-finger tap to remove
          </p>

          {active && (
            <section className="kt-menu-cat" aria-label={active.name}>
              <div className="kt-menu-grid">
                {active.items.map((item) => {
                  const qty = cart[item.id] ?? 0;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      className={`kt-menu-item${qty > 0 ? " is-picked" : ""}`}
                      onClick={() => {
                        if (skipClickRef.current) {
                          skipClickRef.current = false;
                          return;
                        }
                        addItem(item.id);
                      }}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        removeItem(item.id);
                      }}
                      onTouchStart={(e) => {
                        if (e.touches.length >= 2) {
                          e.preventDefault();
                          removeItem(item.id);
                        }
                      }}
                      onPointerDown={(e) => {
                        // Suppress the following click only — remove via
                        // contextmenu so right-click doesn't fire twice.
                        if (e.button === 2) {
                          e.preventDefault();
                          skipClickRef.current = true;
                        }
                      }}
                    >
                      <span className="kt-menu-item-name">{item.name}</span>
                      {qty > 0 && (
                        <span className="kt-menu-item-qty fp-num">{qty}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </section>
          )}
        </>
      )}

      <footer className="kt-submit-bar">
        <div className="kt-submit-bar-left">
          <span className="fp-num kt-cart-count">
            {cartCount} item{cartCount === 1 ? "" : "s"}
          </span>
          {cartCount > 0 && (
            <button
              type="button"
              className="kt-btn kt-btn-ghost"
              onClick={() => onCart({})}
            >
              Clear
            </button>
          )}
        </div>
        <button
          type="button"
          className="kt-btn kt-btn-fire"
          disabled={busy || cartCount === 0}
          onClick={onSubmit}
        >
          Fire ticket
        </button>
      </footer>
    </div>
  );
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
          Drag the ⋮⋮ handle to reorder categories and items. Drop an item onto
          another category in the same area to move it.
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
  bumpLabel,
  bumpStatus,
  onBump,
  onVoid,
}: {
  title: string;
  empty: string;
  tickets: KitchenTicket[];
  now: number;
  busy: boolean;
  bumpLabel: (t: KitchenTicket) => string;
  bumpStatus: (t: KitchenTicket) => "in_progress" | "ready" | "served";
  onBump: (id: string, status: "in_progress" | "ready" | "served") => void;
  onVoid: (id: string) => void;
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
          <span className="kt-dot kt-dot-late" /> 15m+
        </p>
      </header>
      {tickets.length === 0 ? (
        <p className="kt-empty">{empty}</p>
      ) : (
        <div className="kt-ticket-grid">
          {tickets.map((t) => {
            const age = ticketAgeMs(t, now);
            const band = ageBand(age);
            const notes = [
              t.notes,
              ...t.items.map((i) => i.notes).filter(Boolean),
            ]
              .filter(Boolean)
              .join(" · ");
            return (
              <article
                key={t.id}
                className={`kt-ticket kt-age-${band} kt-ticket-${t.status}`}
              >
                <button
                  type="button"
                  className="kt-ticket-bump"
                  disabled={busy}
                  onClick={() => onBump(t.id, bumpStatus(t))}
                  aria-label={`${bumpLabel(t)} — table ${t.tableLabel ?? "walk-in"}`}
                >
                  <header className="kt-ticket-head">
                    <span className="kt-ticket-table">
                      {t.tableLabel ? `T${t.tableLabel}` : "WALK"}
                    </span>
                    <span className={`kt-ticket-timer fp-num kt-timer-${band}`}>
                      {formatElapsed(age)}
                    </span>
                  </header>
                  <ul className="kt-ticket-items">
                    {t.items.map((item) => (
                      <li key={item.id}>
                        <span className="kt-qty fp-num">{item.qty}</span>
                        <span className="kt-item-name">{item.name}</span>
                      </li>
                    ))}
                  </ul>
                  {notes && <p className="kt-ticket-mods">{notes}</p>}
                  <span className="kt-bump-cue">{bumpLabel(t)}</span>
                </button>
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
