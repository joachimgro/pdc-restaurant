"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { fetchAuthMe } from "@/lib/api/client";
import { fetchCapabilities, type Capabilities } from "@/lib/api/capabilities";
import {
  fetchVenueSettings,
  putVenueSettings,
} from "@/plugins/service/api/console";
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

type KitchenMode = "chef" | "pass" | "menu";

const MODES: { id: KitchenMode | "order"; label: string; hint?: string }[] = [
  { id: "order", label: "Order" },
  { id: "chef", label: "Kitchen" },
  { id: "pass", label: "Pass", hint: "Pickup" },
  { id: "menu", label: "Menu", hint: "Edit / import" },
];

/** Industry KDS aging: fresh → warning → late (Toast/Square-style). */
const AGE_WARN_MS = 8 * 60_000;

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

function ticketTableName(label: string | null): string {
  const trimmed = label?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : "Walk-in";
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

function parseTimeMs(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const n = Date.parse(iso);
  return Number.isNaN(n) ? null : n;
}

/** Cook timer from POS send; pass timer from Ready (resets on the pass). */
function ticketAgeMs(
  ticket: KitchenTicket,
  now: number,
  phase: "cook" | "pass" = "cook"
): number {
  const start =
    phase === "pass"
      ? (parseTimeMs(ticket.readyAt) ?? parseTimeMs(ticket.createdAt))
      : parseTimeMs(ticket.createdAt);
  if (start == null) return 0;
  return Math.max(0, now - start);
}

function ageBand(
  ms: number,
  lateMs: number
): "fresh" | "warn" | "late" {
  if (ms >= lateMs) return "late";
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

function formatLiveClock(now: number): string {
  return new Date(now).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function formatClock(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function readKitchenLateMinutes(
  brand: Record<string, unknown> | null | undefined
): number | null {
  const raw = brand?.kitchenLateMinutes;
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
    return Math.round(raw);
  }
  if (typeof raw === "string" && raw.trim() !== "") {
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) return Math.round(n);
  }
  return null;
}

export function KitchenWorkspace() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [caps, setCaps] = useState<Capabilities | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [mode, setMode] = useState<KitchenMode>("chef");
  const [menu, setMenu] = useState<KitchenMenuCategory[]>([]);
  const [tickets, setTickets] = useState<KitchenTicket[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [lateMinutes, setLateMinutes] = useState(KITCHEN_LATE_MINUTES);
  const [lastBumped, setLastBumped] = useState<{
    id: string;
    prev: "in_progress" | "ready" | "served" | "void" | "new";
  } | null>(null);
  const [availUndo, setAvailUndo] = useState<{
    menuItemId: string;
    name: string;
  } | null>(null);
  const [overflowOpen, setOverflowOpen] = useState(false);

  const lateMs = lateMinutes * 60_000;

  useEffect(() => {
    const tab = searchParams.get("tab");
    if (tab === "pass" || tab === "ready") setMode("pass");
    else if (tab === "menu") setMode("menu");
    else if (tab === "kitchen" || tab === "chef") setMode("chef");
  }, [searchParams]);

  useEffect(() => {
    void fetchCapabilities().then(setCaps);
    void fetchAuthMe().then((user) => {
      if (!user) {
        const next = pathname.startsWith("/kitchen")
          ? "/kitchen"
          : "/inbox?view=kitchen";
        router.replace(`/login?next=${encodeURIComponent(next)}`);
        return;
      }
      setIsAdmin(Boolean(user.canManageTeam));
    });
  }, [pathname, router]);

  useEffect(() => {
    void (async () => {
      const result = await fetchVenueSettings();
      if (!result.ok) return;
      const fromBrand = readKitchenLateMinutes(result.data.settings.brand);
      if (fromBrand != null) setLateMinutes(fromBrand);
    })();
  }, []);

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);

  const loadBoard = useCallback(async () => {
    const result = await fetchKitchenTickets(undefined, undefined, {
      active: true,
    });
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
      fetchKitchenTickets(undefined, undefined, { active: true }),
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

  const readyTickets = useMemo(() => {
    const list = tickets.filter((t) => t.status === "ready");
    return [...list].sort(
      (a, b) => ticketAgeMs(b, now, "pass") - ticketAgeMs(a, now, "pass")
    );
  }, [tickets, now]);

  const kitchenTickets = useMemo(() => {
    const list = tickets.filter(
      (t) => t.status === "new" || t.status === "in_progress"
    );
    return [...list].sort(
      (a, b) => ticketAgeMs(b, now, "cook") - ticketAgeMs(a, now, "cook")
    );
  }, [tickets, now]);

  const lateCount = useMemo(
    () =>
      kitchenTickets.filter(
        (t) => ageBand(ticketAgeMs(t, now, "cook"), lateMs) === "late"
      ).length,
    [kitchenTickets, now, lateMs]
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

  const kiosk = mode !== "menu";
  const boardCount = mode === "pass" ? readyTickets.length : kitchenTickets.length;

  function goMode(next: KitchenMode) {
    setOverflowOpen(false);
    if (next === "menu") {
      setMode("menu");
      router.push("/inbox?view=kitchen&tab=menu");
      return;
    }
    setMode(next);
    if (pathname.startsWith("/kitchen")) {
      router.replace(next === "pass" ? "/kitchen?tab=pass" : "/kitchen");
      return;
    }
    const params = new URLSearchParams(searchParams.toString());
    params.set("view", "kitchen");
    if (next === "chef") params.delete("tab");
    else params.set("tab", next);
    router.replace(`/inbox?${params.toString()}`, { scroll: false });
  }

  if (!caps) {
    return (
      <div className="kt-root kt-kiosk">
        <header className="kt-kiosk-bar">
          <time className="kt-kiosk-clock fp-num">{formatLiveClock(now)}</time>
        </header>
        <p className="kt-empty">Loading…</p>
      </div>
    );
  }

  if (!caps.kitchen) {
    return (
      <div className="kt-root kt-kiosk">
        <header className="kt-kiosk-bar">
          <time className="kt-kiosk-clock fp-num">{formatLiveClock(now)}</time>
        </header>
        <p className="kt-empty">Kitchen module is not enabled for this venue.</p>
      </div>
    );
  }

  if (status === "loading") {
    return (
      <div className="kt-root kt-kiosk">
        <header className="kt-kiosk-bar">
          <time className="kt-kiosk-clock fp-num">{formatLiveClock(now)}</time>
        </header>
        <p className="kt-empty">Loading kitchen</p>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="kt-root kt-kiosk">
        <header className="kt-kiosk-bar">
          <time className="kt-kiosk-clock fp-num">{formatLiveClock(now)}</time>
        </header>
        <div className="kt-empty">
          <p>{error}</p>
          <button type="button" className="kt-btn" onClick={() => void load()}>
            Try again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`kt-root${kiosk ? " kt-kiosk" : ""}`}
      style={kiosk ? undefined : { gridColumn: "2 / -1" }}
    >
      {kiosk ? (
        <header className="kt-kiosk-bar">
          <time className="kt-kiosk-clock fp-num" dateTime={new Date(now).toISOString()}>
            {formatLiveClock(now)}
          </time>
          <span className="kt-kiosk-title">
            {mode === "pass" ? "Pass" : "Kitchen"}
            <span className="kt-board-count fp-num">{boardCount}</span>
          </span>
          <div className="kt-kiosk-meta">
            {lateCount > 0 && mode === "chef" && (
              <span
                className="kt-late-pill"
                title={`Tickets over ${lateMinutes} minutes`}
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
                Undo
              </button>
            )}
            <div className="kt-overflow-wrap">
              <button
                type="button"
                className="kt-overflow-btn"
                aria-label="More"
                aria-expanded={overflowOpen}
                onClick={() => setOverflowOpen((o) => !o)}
              >
                ⋯
              </button>
              {overflowOpen && (
                <div className="kt-overflow-menu" role="menu">
                  <button
                    type="button"
                    className="kt-overflow-item"
                    role="menuitem"
                    onClick={() => goMode("chef")}
                  >
                    Kitchen
                  </button>
                  <button
                    type="button"
                    className="kt-overflow-item"
                    role="menuitem"
                    onClick={() => goMode("pass")}
                  >
                    Pass
                  </button>
                  <a
                    className="kt-overflow-item"
                    href="/order"
                    role="menuitem"
                    onClick={() => setOverflowOpen(false)}
                  >
                    Order
                  </a>
                  <button
                    type="button"
                    className="kt-overflow-item"
                    role="menuitem"
                    onClick={() => goMode("menu")}
                  >
                    Menu
                  </button>
                  <a
                    className="kt-overflow-item"
                    href="/inbox"
                    role="menuitem"
                    onClick={() => setOverflowOpen(false)}
                  >
                    Back to app
                  </a>
                </div>
              )}
            </div>
          </div>
        </header>
      ) : (
      <div className="kt-panel kt-mode-bar">
        <div
          className="kt-mode-segment kt-mode-segment-4"
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
                const next = new URLSearchParams(searchParams.toString());
                next.set("view", "kitchen");
                if (m.id === "chef") next.delete("tab");
                else next.set("tab", m.id);
                router.replace(`/inbox?${next.toString()}`, { scroll: false });
              }}
            >
              <span className="kt-mode-label">
                {m.label}
                {m.id === "pass" && readyTickets.length > 0
                  ? ` · ${readyTickets.length}`
                  : ""}
              </span>
              {m.hint ? <span className="kt-mode-hint">{m.hint}</span> : null}
            </button>
          ))}
        </div>
        <div className="kt-board-meta">
          {lateCount > 0 && (
            <span
              className="kt-late-pill"
              title={`Tickets over ${lateMinutes} minutes`}
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
      )}

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
            lateMinutes={lateMinutes}
            onBump={(id, s) => void setTicketStatus(id, s)}
            onVoid={(id) => void setTicketStatus(id, "void")}
            onEightySix={(menuItemId, name) =>
              void eightySixItem(menuItemId, name)
            }
          />
        )}
        {mode === "pass" && (
          <TicketBoard
            title="Pass"
            empty="Nothing waiting on the pass."
            tickets={readyTickets}
            now={now}
            busy={busy}
            lateMinutes={lateMinutes}
            variant="pass"
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
            isAdmin={isAdmin}
            lateMinutes={lateMinutes}
            onLateMinutesChange={setLateMinutes}
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
  const maxEdge = 1920;
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
    canvas.toBlob((b) => resolve(b), "image/jpeg", 0.9)
  );
  return blob ?? file;
}

function MenuEditor({
  menu,
  busy,
  setBusy,
  isAdmin,
  lateMinutes,
  onLateMinutesChange,
  onError,
  onChanged,
  onMenuUpdate,
}: {
  menu: KitchenMenuCategory[];
  busy: boolean;
  setBusy: (v: boolean) => void;
  isAdmin: boolean;
  lateMinutes: number;
  onLateMinutesChange: (n: number) => void;
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
  const [lateDraft, setLateDraft] = useState(String(lateMinutes));
  const [lateSaving, setLateSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setLateDraft(String(lateMinutes));
  }, [lateMinutes]);

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

  async function saveLateMinutes() {
    const parsed = Number(lateDraft);
    if (!Number.isFinite(parsed) || parsed < 1 || parsed > 120) {
      onError("Kitchen late minutes must be between 1 and 120.");
      return;
    }
    const next = Math.round(parsed);
    setLateSaving(true);
    onError(null);
    setNotice(null);
    const current = await fetchVenueSettings();
    if (!current.ok) {
      setLateSaving(false);
      onError(current.error);
      return;
    }
    const settings = current.data.settings;
    const brand = {
      ...(settings.brand ?? {}),
      kitchenLateMinutes: next,
    };
    const { locationId: _locationId, ...input } = settings;
    const result = await putVenueSettings({ ...input, brand });
    setLateSaving(false);
    if (!result.ok) {
      onError(result.error);
      return;
    }
    const saved =
      readKitchenLateMinutes(result.data.settings.brand) ?? next;
    onLateMinutesChange(saved);
    setLateDraft(String(saved));
    setNotice(`Kitchen late threshold set to ${saved} minutes.`);
  }

  return (
    <div className="kt-menu-editor">
      {isAdmin && (
        <section className="kt-editor-block">
          <h2 className="kt-board-title">Kitchen timing</h2>
          <p className="kt-editor-help">
            Minutes before an open ticket shows as late on the board. Stored in
            venue brand settings.
          </p>
          <div className="kt-editor-row">
            <label className="kt-radio" style={{ gap: 8 }}>
              Kitchen late (minutes)
              <input
                className="kt-input kt-input-price"
                type="number"
                min={1}
                max={120}
                inputMode="numeric"
                value={lateDraft}
                onChange={(e) => setLateDraft(e.target.value)}
                aria-label="Kitchen late minutes"
              />
            </label>
            <button
              type="button"
              className="kt-btn"
              disabled={busy || lateSaving}
              onClick={() => void saveLateMinutes()}
            >
              {lateSaving ? "Saving…" : "Save"}
            </button>
          </div>
        </section>
      )}

      <section className="kt-editor-block">
        <h2 className="kt-board-title">Import menu</h2>
        <p className="kt-editor-help">
          Photo a printed menu. AI transcribes it, then a second pass tidies
          names, prices, and sections. Review the JSON below before Import — or
          paste <code>## Mains</code> text / a categories JSON blob.
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
  variant = "cook",
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
  variant?: "cook" | "pass";
  onBump: (id: string, status: "in_progress" | "ready" | "served") => void;
  onVoid: (id: string) => void;
  onEightySix: (menuItemId: string | null, name: string) => void;
}) {
  const isPass = variant === "pass";
  return (
    <div className={`kt-board${isPass ? " kt-board-pass" : ""}`}>
      <header className="kt-board-head">
        <h2 className="kt-board-title">
          {title}
          <span className="kt-board-count fp-num">{tickets.length}</span>
        </h2>
        <p className="kt-board-legend">
          {isPass ? (
            "Timer from ready — tap picked up when you leave the pass"
          ) : (
            <>
              <span className="kt-dot kt-dot-fresh" /> Fresh
              <span className="kt-dot kt-dot-warn" /> 8m+
              <span className="kt-dot kt-dot-late" /> {lateMinutes}m+
            </>
          )}
        </p>
      </header>
      {tickets.length === 0 ? (
        <p className="kt-empty">{empty}</p>
      ) : (
        <div className={`kt-ticket-grid${isPass ? " is-pass" : ""}`}>
          {tickets.map((t) => {
            const phase = isPass ? "pass" : "cook";
            const age = ticketAgeMs(t, now, phase);
            const band = ageBand(age, lateMinutes * 60_000);
            const modeLabel = serveModeLabel(t.serveMode);
            const isBar = normalizeStation(t.station) === "bar";
            const courseGroups = groupTicketItemsByCourse(t.items);
            const showCourseHeaders =
              courseGroups.length > 1 ||
              courseGroups.some((g) => g.course != null);
            const canReady =
              t.status === "new" || t.status === "in_progress";
            const canServed = t.status === "ready";
            return (
              <article
                key={t.id}
                className={`kt-ticket kt-age-${band} kt-ticket-${t.status}${
                  isPass ? " is-pass" : ""
                }`}
              >
                <div className="kt-ticket-body">
                  <header className="kt-ticket-head">
                    <div className="kt-ticket-table-block">
                      <span className="kt-ticket-eyebrow">
                        {isPass ? "Take to" : "Table"}
                      </span>
                      <span className="kt-ticket-table">
                        {ticketTableName(t.tableLabel)}
                      </span>
                      <span className="kt-ticket-meta">
                        {t.covers != null && t.covers > 0 && (
                          <span className="kt-serve-badge">
                            {t.covers} cover{t.covers === 1 ? "" : "s"}
                          </span>
                        )}
                        {modeLabel && (
                          <span className="kt-serve-badge">{modeLabel}</span>
                        )}
                        {isBar && (
                          <span className="kt-station-chip-inline">Bar</span>
                        )}
                      </span>
                    </div>
                    <div className="kt-ticket-times">
                      <span className={`kt-ticket-timer fp-num kt-timer-${band}`}>
                        {formatElapsed(age)}
                      </span>
                      {isPass && t.readyAt ? (
                        <span className="kt-ticket-sent is-ready">
                          Ready {formatClock(t.readyAt)}
                        </span>
                      ) : null}
                      <span className="kt-ticket-sent">
                        Sent {formatClock(t.createdAt)}
                      </span>
                    </div>
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
                              {!isPass && item.menuItemId ? (
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
                    {!isPass && canReady && (
                      <button
                        type="button"
                        className="kt-bump-btn kt-bump-ready"
                        disabled={busy}
                        onClick={() => onBump(t.id, "ready")}
                      >
                        Ready
                      </button>
                    )}
                    {isPass && canServed && (
                      <button
                        type="button"
                        className="kt-bump-btn kt-bump-served kt-bump-pickup"
                        disabled={busy}
                        onClick={() => onBump(t.id, "served")}
                      >
                        Picked up
                      </button>
                    )}
                  </div>
                </div>
                {!isPass && (
                  <button
                    type="button"
                    className="kt-void-btn"
                    disabled={busy}
                    onClick={() => onVoid(t.id)}
                    aria-label="Void ticket"
                  >
                    Void
                  </button>
                )}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
