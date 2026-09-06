"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { fetchAuthMe } from "@/lib/api/client";
import {
  fetchFloorPlan,
  fetchVenueSettings,
} from "@/plugins/service/api/console";
import type { FloorPlan, Room } from "@lead-intake/shared-types";
import {
  createKitchenOrder,
  fetchKitchenMenu,
  fetchKitchenTickets,
  type KitchenMenuCategory,
  type KitchenMenuChoiceGroup,
  type KitchenMenuItem,
  type KitchenTicket,
} from "./api";
import { QUICK_NOTES } from "./quickNotes";
import type { CourseId, ServeMode, TicketLine } from "./types";
import { OrderFloorCanvas } from "./OrderFloorCanvas";
import "./order.css";

const COURSE_CYCLE: Array<CourseId | null> = [
  "starter",
  "main",
  "dessert",
  null,
];

const COURSE_GROUPS: { id: CourseId | "other"; label: string }[] = [
  { id: "starter", label: "Starters" },
  { id: "main", label: "Mains" },
  { id: "dessert", label: "Desserts" },
  { id: "other", label: "Other" },
];

const SERVE_MODES: { id: ServeMode; label: string }[] = [
  { id: "courses", label: "In courses" },
  { id: "as_it_comes", label: "As it comes" },
  { id: "all_together", label: "All together" },
];

const OPEN_STATUSES = new Set(["new", "in_progress", "ready"]);

function formatPrice(pence: number): string {
  return `£${(pence / 100).toFixed(pence % 100 === 0 ? 0 : 2)}`;
}

function newLineKey(): string {
  return crypto.randomUUID();
}

function nextCourse(current: string | null): string | null {
  const idx = COURSE_CYCLE.findIndex((c) => c === current);
  const next = COURSE_CYCLE[(idx + 1) % COURSE_CYCLE.length];
  return next ?? null;
}

function courseGroupId(course: string | null): CourseId | "other" {
  if (course === "starter" || course === "main" || course === "dessert") {
    return course;
  }
  return "other";
}

type ChoiceFlow = {
  item: KitchenMenuItem;
  category: KitchenMenuCategory;
  groups: KitchenMenuChoiceGroup[];
  picks: Array<string | null | undefined>;
};

const CAT_TONES = 8;

function itemChoices(item: KitchenMenuItem): KitchenMenuChoiceGroup[] {
  return item.choices?.filter((g) => g.options.length > 0) ?? [];
}

type NoteSheet = {
  lineKey: string;
  selected: string[];
  custom: string;
  showCustom: boolean;
};

type Banner =
  | { kind: "ok"; text: string }
  | { kind: "err"; text: string };

export function OrderWorkspace() {
  const router = useRouter();
  const [authReady, setAuthReady] = useState(false);
  const [screen, setScreen] = useState<"tables" | "order">("tables");
  const [floor, setFloor] = useState<FloorPlan | null>(null);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [menu, setMenu] = useState<KitchenMenuCategory[]>([]);
  const [tickets, setTickets] = useState<KitchenTicket[]>([]);
  const [tableLabel, setTableLabel] = useState<string | null>(null);
  const [lines, setLines] = useState<TicketLine[]>([]);
  const [covers, setCovers] = useState<number | null>(null);
  const [serveMode, setServeMode] = useState<ServeMode>("courses");
  const [orderKey, setOrderKey] = useState<string | null>(null);
  const [activeCatId, setActiveCatId] = useState<string | null>(null);
  const [menuQuery, setMenuQuery] = useState("");
  const [sentOpen, setSentOpen] = useState(false);
  const [overflowOpen, setOverflowOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [banner, setBanner] = useState<Banner | null>(null);
  const [choiceFlow, setChoiceFlow] = useState<ChoiceFlow | null>(null);
  const [noteSheet, setNoteSheet] = useState<NoteSheet | null>(null);
  const [highlightIds, setHighlightIds] = useState<string[]>([]);
  const [quickNotes, setQuickNotes] = useState<string[]>([...QUICK_NOTES]);
  const bannerTimer = useRef<number | null>(null);
  const retryTimer = useRef<number | null>(null);
  const autoRetriedRef = useRef(false);
  const ticketPaneRef = useRef<HTMLDivElement | null>(null);

  const ensureOrderKey = useCallback(() => {
    setOrderKey((prev) => prev ?? crypto.randomUUID());
  }, []);

  const loadMenu = useCallback(async () => {
    const result = await fetchKitchenMenu();
    if (result.ok) {
      setMenu(result.data.categories);
      setActiveCatId((prev) =>
        prev && result.data.categories.some((c) => c.id === prev) ? prev : null
      );
    }
  }, []);

  const loadTickets = useCallback(async () => {
    const result = await fetchKitchenTickets(undefined, undefined, {
      active: true,
    });
    if (result.ok) setTickets(result.data.tickets);
  }, []);

  const loadFloor = useCallback(async () => {
    const result = await fetchFloorPlan();
    if (result.ok) {
      setFloor(result.data);
      setRoomId((prev) => {
        const active = result.data.rooms.filter((r) => r.isActive);
        if (prev && active.some((r) => r.id === prev)) return prev;
        return active[0]?.id ?? null;
      });
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const user = await fetchAuthMe();
      if (cancelled) return;
      if (!user) {
        router.replace("/login?next=/order");
        return;
      }
      setAuthReady(true);
      await Promise.all([loadFloor(), loadMenu(), loadTickets()]);
      const settingsResult = await fetchVenueSettings();
      if (cancelled || !settingsResult.ok) return;
      const notes = settingsResult.data.settings.brand?.quickNotes;
      if (
        Array.isArray(notes) &&
        notes.every((n): n is string => typeof n === "string") &&
        notes.length > 0
      ) {
        const list = notes.includes("Custom") ? notes : [...notes, "Custom"];
        setQuickNotes(list);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router, loadFloor, loadMenu, loadTickets]);

  useEffect(() => {
    if (screen !== "order") return;
    const timer = window.setInterval(() => void loadMenu(), 30_000);
    return () => window.clearInterval(timer);
  }, [screen, loadMenu]);

  useEffect(() => {
    return () => {
      if (bannerTimer.current) window.clearTimeout(bannerTimer.current);
      if (retryTimer.current) window.clearTimeout(retryTimer.current);
    };
  }, []);

  const activeRoom: Room | null = useMemo(() => {
    if (!floor || !roomId) return null;
    return floor.rooms.find((r) => r.id === roomId) ?? null;
  }, [floor, roomId]);

  const openByTable = useMemo(() => {
    const map = new Map<string, { count: number; tickets: KitchenTicket[] }>();
    for (const t of tickets) {
      if (!t.tableLabel || !OPEN_STATUSES.has(t.status)) continue;
      const itemCount = t.items.reduce((n, i) => n + i.qty, 0);
      const cur = map.get(t.tableLabel) ?? { count: 0, tickets: [] };
      cur.count += itemCount;
      cur.tickets.push(t);
      map.set(t.tableLabel, cur);
    }
    return map;
  }, [tickets]);

  const sentForTable = useMemo(() => {
    if (!tableLabel) return [];
    return openByTable.get(tableLabel)?.tickets ?? [];
  }, [openByTable, tableLabel]);

  const sentItemCount = useMemo(
    () =>
      sentForTable.reduce(
        (n, t) => n + t.items.reduce((m, i) => m + i.qty, 0),
        0
      ),
    [sentForTable]
  );

  const lineCount = useMemo(
    () => lines.reduce((n, l) => n + l.qty, 0),
    [lines]
  );

  const ticketTotal = useMemo(
    () => lines.reduce((n, l) => n + l.pricePence * l.qty, 0),
    [lines]
  );

  const qtyByItem = useMemo(() => {
    const map = new Map<string, number>();
    for (const l of lines) {
      map.set(l.menuItemId, (map.get(l.menuItemId) ?? 0) + l.qty);
    }
    return map;
  }, [lines]);

  const groupedLines = useMemo(() => {
    const groups = COURSE_GROUPS.map((g) => ({
      ...g,
      lines: lines.filter((l) => courseGroupId(l.course) === g.id),
    })).filter((g) => g.lines.length > 0);
    return groups;
  }, [lines]);

  const activeCategory = useMemo(
    () => menu.find((c) => c.id === activeCatId) ?? null,
    [menu, activeCatId]
  );

  const browsing = useMemo(() => {
    const q = menuQuery.trim().toLowerCase();
    if (q) {
      return menu.flatMap((category) =>
        category.items
          .filter((item) => item.name.toLowerCase().includes(q))
          .map((item) => ({ item, category }))
      );
    }
    return (activeCategory?.items ?? []).map((item) => ({
      item,
      category: activeCategory!,
    }));
  }, [menu, menuQuery, activeCategory]);

  const searching = menuQuery.trim().length > 0;
  const inSection = Boolean(activeCategory) || searching;

  const qtyByCategory = useMemo(() => {
    const map = new Map<string, number>();
    for (const cat of menu) {
      let n = 0;
      for (const item of cat.items) n += qtyByItem.get(item.id) ?? 0;
      if (n > 0) map.set(cat.id, n);
    }
    return map;
  }, [menu, qtyByItem]);

  function showBanner(next: Banner, autoClearMs?: number) {
    if (bannerTimer.current) window.clearTimeout(bannerTimer.current);
    setBanner(next);
    if (autoClearMs) {
      bannerTimer.current = window.setTimeout(() => setBanner(null), autoClearMs);
    }
  }

  function resetTicket() {
    setLines([]);
    setCovers(null);
    setServeMode("courses");
    setOrderKey(null);
    setMenuQuery("");
    setActiveCatId(null);
    setSentOpen(false);
    setChoiceFlow(null);
    setNoteSheet(null);
    setHighlightIds([]);
    autoRetriedRef.current = false;
    if (retryTimer.current) {
      window.clearTimeout(retryTimer.current);
      retryTimer.current = null;
    }
  }

  function openTable(label: string) {
    resetTicket();
    setTableLabel(label);
    setScreen("order");
    void loadMenu();
    void loadTickets();
  }

  function changeTable() {
    resetTicket();
    setTableLabel(null);
    setScreen("tables");
    void loadTickets();
  }

  function addLine(
    item: KitchenMenuItem,
    category: KitchenMenuCategory,
    notes: string
  ) {
    ensureOrderKey();
    const course = category.defaultCourse ?? null;
    setLines((prev) => {
      const match = prev.find(
        (l) =>
          l.menuItemId === item.id &&
          l.notes === notes &&
          l.course === course
      );
      if (match) {
        return prev.map((l) =>
          l.key === match.key ? { ...l, qty: l.qty + 1 } : l
        );
      }
      return [
        ...prev,
        {
          key: newLineKey(),
          menuItemId: item.id,
          name: item.name,
          qty: 1,
          notes,
          course,
          pricePence: item.pricePence,
        },
      ];
    });
  }

  function onTapMenuItem(item: KitchenMenuItem, category: KitchenMenuCategory) {
    if (!item.available) return;
    const choices = itemChoices(item);
    if (choices.length > 0) {
      setChoiceFlow({
        item,
        category,
        groups: choices,
        picks: choices.map(() => undefined),
      });
      return;
    }
    addLine(item, category, "");
  }

  function commitChoices(
    item: KitchenMenuItem,
    category: KitchenMenuCategory,
    parts: Array<string | null | undefined>
  ) {
    const notes = parts.filter((p): p is string => Boolean(p)).join(", ");
    addLine(item, category, notes);
    setChoiceFlow(null);
  }

  function requiredChoicesFilled(groups: KitchenMenuChoiceGroup[], picks: Array<string | null | undefined>) {
    return groups.every((g, i) => !g.required || typeof picks[i] === "string");
  }

  function pickChoiceOption(groupIndex: number, option: string) {
    if (!choiceFlow) return;
    const next = [...choiceFlow.picks];
    next[groupIndex] = option;
    const requiredDone = requiredChoicesFilled(choiceFlow.groups, next);
    if (requiredDone) {
      commitChoices(choiceFlow.item, choiceFlow.category, next);
      return;
    }
    setChoiceFlow({ ...choiceFlow, picks: next });
  }

  function skipChoiceGroup(groupIndex: number) {
    if (!choiceFlow) return;
    const group = choiceFlow.groups[groupIndex];
    if (!group || group.required) return;
    const next = [...choiceFlow.picks];
    next[groupIndex] = null;
    const requiredDone = requiredChoicesFilled(choiceFlow.groups, next);
    if (requiredDone) {
      commitChoices(choiceFlow.item, choiceFlow.category, next);
      return;
    }
    setChoiceFlow({ ...choiceFlow, picks: next });
  }

  function updateLineQty(key: string, delta: number) {
    ensureOrderKey();
    setLines((prev) =>
      prev
        .map((l) => (l.key === key ? { ...l, qty: l.qty + delta } : l))
        .filter((l) => l.qty > 0)
    );
  }

  function cycleLineCourse(key: string) {
    ensureOrderKey();
    setLines((prev) =>
      prev.map((l) =>
        l.key === key ? { ...l, course: nextCourse(l.course) } : l
      )
    );
  }

  function openNoteSheet(line: TicketLine) {
    setNoteSheet({
      lineKey: line.key,
      selected: [],
      custom: "",
      showCustom: false,
    });
  }

  function saveNotes() {
    if (!noteSheet) return;
    const parts = [...noteSheet.selected];
    if (noteSheet.showCustom && noteSheet.custom.trim()) {
      parts.push(noteSheet.custom.trim());
    }
    const notes = parts.join(", ");
    ensureOrderKey();
    setLines((prev) =>
      prev.map((l) =>
        l.key === noteSheet.lineKey ? { ...l, notes } : l
      )
    );
    setNoteSheet(null);
  }

  async function sendOrder(opts?: { isAutoRetry?: boolean }) {
    if (!tableLabel || lines.length === 0 || sending) return;
    if (!opts?.isAutoRetry) {
      autoRetriedRef.current = false;
      if (retryTimer.current) {
        window.clearTimeout(retryTimer.current);
        retryTimer.current = null;
      }
    }
    const key = orderKey ?? crypto.randomUUID();
    if (!orderKey) setOrderKey(key);
    setSending(true);
    setHighlightIds([]);
    const result = await createKitchenOrder({
      orderKey: key,
      tableLabel,
      covers,
      serveMode,
      items: lines.map((l) => ({
        menuItemId: l.menuItemId,
        qty: l.qty,
        course: l.course,
        notes: l.notes || null,
      })),
    });
    setSending(false);
    if (!result.ok) {
      if (
        result.code === "UNAUTHORIZED" ||
        result.code === "HTTP_401"
      ) {
        router.replace("/login?next=/order");
        return;
      }
      if (result.code === "ITEM_UNAVAILABLE") {
        const details = result.details as { itemIds?: unknown } | undefined;
        const ids = Array.isArray(details?.itemIds)
          ? details.itemIds.filter((id): id is string => typeof id === "string")
          : [];
        const idSet = new Set(ids);
        setHighlightIds(ids);
        const names = [
          ...new Set(
            lines.filter((l) => idSet.has(l.menuItemId)).map((l) => l.name)
          ),
        ];
        const label =
          names.length === 0
            ? "An item"
            : names.length === 1
              ? names[0]
              : names.join(", ");
        showBanner({
          kind: "err",
          text: `${label} is 86'd, remove it to send`,
        });
        void loadMenu();
        return;
      }
      const retryable =
        result.code === "NETWORK" || /^HTTP_5\d\d$/.test(result.code);
      showBanner({
        kind: "err",
        text: "Not sent to kitchen. Tap to retry.",
      });
      if (retryable && !autoRetriedRef.current) {
        autoRetriedRef.current = true;
        retryTimer.current = window.setTimeout(() => {
          void sendOrder({ isAutoRetry: true });
        }, 2000);
      }
      return;
    }
    showBanner({ kind: "ok", text: `Sent · Table ${tableLabel}` }, 1000);
    resetTicket();
    setTableLabel(null);
    setScreen("tables");
    void loadTickets();
  }

  function clearTicketConfirmed() {
    if (!window.confirm("Clear this ticket?")) return;
    resetTicket();
    setOverflowOpen(false);
  }

  if (!authReady) {
    return (
      <div className="od-root">
        <div className="od-topbar">
          <span className="od-topbar-title">Order</span>
        </div>
      </div>
    );
  }

  const courseLabel = (course: string | null) => {
    if (course === "starter") return "Starter";
    if (course === "main") return "Main";
    if (course === "dessert") return "Dessert";
    return "No course";
  };

  return (
    <div className="od-root">
      {banner && (
        <button
          type="button"
          className={`od-banner is-${banner.kind}`}
          onClick={() => {
            if (banner.kind === "err") void sendOrder();
            else setBanner(null);
          }}
        >
          {banner.text}
        </button>
      )}

      <header className="od-topbar">
        <span className="od-topbar-title">
          {screen === "tables" ? "Tables" : `Order · ${tableLabel}`}
        </span>
        <div className="od-overflow-wrap">
          <button
            type="button"
            className="od-overflow-btn"
            aria-label="More"
            aria-expanded={overflowOpen}
            onClick={() => setOverflowOpen((o) => !o)}
          >
            ⋯
          </button>
          {overflowOpen && (
            <div className="od-overflow-menu" role="menu">
              <a
                className="od-overflow-item"
                href="/kitchen"
                role="menuitem"
                onClick={() => setOverflowOpen(false)}
              >
                Kitchen board
              </a>
              <a
                className="od-overflow-item"
                href="/inbox"
                role="menuitem"
                onClick={() => setOverflowOpen(false)}
              >
                Back to app
              </a>
              {screen === "order" && (
                <button
                  type="button"
                  className="od-overflow-item is-danger"
                  role="menuitem"
                  onClick={clearTicketConfirmed}
                >
                  Clear ticket
                </button>
              )}
            </div>
          )}
        </div>
      </header>

      {screen === "tables" ? (
        <div className="od-tables">
          <div className="od-room-tabs" role="tablist" aria-label="Rooms">
            {(floor?.rooms ?? [])
              .filter((room) => room.isActive)
              .map((room) => (
              <button
                key={room.id}
                type="button"
                role="tab"
                aria-selected={room.id === roomId}
                className={`od-room-tab${room.id === roomId ? " is-active" : ""}`}
                onClick={() => setRoomId(room.id)}
              >
                {room.name}
              </button>
            ))}
          </div>
          {activeRoom ? (
            <div className="od-floor-stage">
              <OrderFloorCanvas
                key={activeRoom.id}
                room={activeRoom}
                openByTable={openByTable}
                onSelect={openTable}
              />
            </div>
          ) : (
            <p className="od-empty">No rooms in the floor plan yet.</p>
          )}
          <div className="od-bar-row">
            <button
              type="button"
              className="od-bar-btn"
              onClick={() => openTable("Bar")}
            >
              <span className="od-table-label">Bar</span>
              {openByTable.get("Bar") && openByTable.get("Bar")!.count > 0 && (
                <span className="od-table-meta">
                  <span className="od-table-dot" aria-hidden />
                  {openByTable.get("Bar")!.count}
                </span>
              )}
            </button>
          </div>
        </div>
      ) : (
        <div className="od-order">
          <section className="od-menu">
            {choiceFlow ? (
              <div className="od-mod" role="dialog" aria-label="Item options">
                <div className="od-drill-bar">
                  <button
                    type="button"
                    className="od-back"
                    onClick={() => setChoiceFlow(null)}
                  >
                    ← Back
                  </button>
                  <div className="od-drill-copy">
                    <span className="od-drill-title">{choiceFlow.item.name}</span>
                    <span className="od-drill-hint">
                      {choiceFlow.groups.length === 1
                        ? "Tap to add"
                        : "Pick each option — adds when ready"}
                    </span>
                  </div>
                </div>
                <div className="od-mod-body">
                  {choiceFlow.groups.map((group, gi) => (
                    <div key={`${group.label}-${gi}`} className="od-mod-group">
                      <div className="od-mod-label">
                        {group.label}
                        {group.required ? (
                          <span className="od-mod-req">Required</span>
                        ) : (
                          <span className="od-mod-opt">Optional</span>
                        )}
                      </div>
                      <div className="od-mod-grid">
                        {group.options.map((opt) => (
                          <button
                            key={opt}
                            type="button"
                            className={`od-mod-opt-btn${
                              choiceFlow.picks[gi] === opt ? " is-on" : ""
                            }`}
                            onClick={() => pickChoiceOption(gi, opt)}
                          >
                            {opt}
                          </button>
                        ))}
                        {!group.required && (
                          <button
                            type="button"
                            className={`od-mod-opt-btn is-skip${
                              choiceFlow.picks[gi] === null ? " is-on" : ""
                            }`}
                            onClick={() => skipChoiceGroup(gi)}
                          >
                            None
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <>
                {inSection && (
                  <div className="od-drill-bar">
                    <button
                      type="button"
                      className="od-back"
                      onClick={() => {
                        if (searching) {
                          setMenuQuery("");
                          return;
                        }
                        setActiveCatId(null);
                      }}
                    >
                      ← Back
                    </button>
                    <div className="od-drill-copy">
                      <span className="od-drill-title">
                        {searching ? "Search" : activeCategory?.name}
                      </span>
                      {!searching && activeCategory && (
                        <span className="od-drill-hint">
                          {activeCategory.items.length} item
                          {activeCategory.items.length === 1 ? "" : "s"}
                        </span>
                      )}
                    </div>
                  </div>
                )}

                <div className="od-search">
                  <span className="od-search-icon" aria-hidden>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                      <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
                      <path d="M20 20l-3.5-3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    </svg>
                  </span>
                  <input
                    className="od-search-input"
                    value={menuQuery}
                    onChange={(e) => setMenuQuery(e.target.value)}
                    placeholder="Search menu"
                    type="search"
                    enterKeyHint="search"
                    autoCapitalize="off"
                    autoCorrect="off"
                  />
                  {searching && (
                    <button
                      type="button"
                      className="od-search-clear"
                      aria-label="Clear search"
                      onClick={() => setMenuQuery("")}
                    >
                      ×
                    </button>
                  )}
                </div>

                {!inSection ? (
                  <div className="od-cat-grid" aria-label="Categories">
                    {menu.map((cat, i) => {
                      const count = cat.items.filter((it) => it.available).length;
                      const onTicket = qtyByCategory.get(cat.id) ?? 0;
                      return (
                        <button
                          key={cat.id}
                          type="button"
                          className={`od-cat-card od-tone-${i % CAT_TONES}${
                            onTicket > 0 ? " is-in" : ""
                          }`}
                          onClick={() => setActiveCatId(cat.id)}
                        >
                          <span className="od-cat-name">{cat.name}</span>
                          <span className="od-cat-count">
                            {count} item{count === 1 ? "" : "s"}
                          </span>
                          {onTicket > 0 && (
                            <span className="od-cat-badge">{onTicket}</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="od-item-grid">
                    {browsing.length === 0 && (
                      <p className="od-empty-menu">
                        {searching ? "No matching items" : "No items in this section"}
                      </p>
                    )}
                    {browsing.map(({ item, category }) => {
                      const qty = qtyByItem.get(item.id) ?? 0;
                      const catIndex = menu.findIndex((c) => c.id === category.id);
                      const band = (catIndex >= 0 ? catIndex : 0) % CAT_TONES;
                      const choices = itemChoices(item);
                      const configurable = choices.length > 0;
                      return (
                        <button
                          key={item.id}
                          type="button"
                          className={`od-item od-tone-${band}${
                            qty > 0 ? " is-in" : ""
                          }${item.available ? "" : " is-86"}`}
                          disabled={!item.available}
                          onClick={() => onTapMenuItem(item, category)}
                        >
                          <span className="od-item-name">{item.name}</span>
                          {item.description ? (
                            <span className="od-item-desc">{item.description}</span>
                          ) : null}
                          {searching && (
                            <span className="od-item-cat">{category.name}</span>
                          )}
                          <span className="od-item-meta">
                            <span className="od-item-price">
                              {formatPrice(item.pricePence)}
                            </span>
                            {configurable && item.available && (
                              <span className="od-item-opts">Options</span>
                            )}
                            {!item.available && (
                              <span className="od-menu-86">86</span>
                            )}
                          </span>
                          {qty > 0 && (
                            <span className="od-item-qty">{qty}</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </>
            )}
          </section>

          <aside className="od-ticket" ref={ticketPaneRef}>
            <div className="od-ticket-header">
              <div className="od-ticket-row">
                <span className="od-ticket-table">{tableLabel}</span>
                <button
                  type="button"
                  className="od-link-btn"
                  onClick={changeTable}
                >
                  Change
                </button>
              </div>
              <div className="od-ticket-row">
                <span className="od-ticket-label">Covers</span>
                <div className="od-covers" aria-label="Covers">
                  <button
                    type="button"
                    className="od-covers-btn"
                    aria-label="Fewer covers"
                    onClick={() =>
                      setCovers((c) => {
                        ensureOrderKey();
                        if (c == null || c <= 1) return null;
                        return c - 1;
                      })
                    }
                  >
                    −
                  </button>
                  <span className="od-covers-val">{covers ?? "—"}</span>
                  <button
                    type="button"
                    className="od-covers-btn"
                    aria-label="More covers"
                    onClick={() => {
                      ensureOrderKey();
                      setCovers((c) => (c == null ? 1 : c + 1));
                    }}
                  >
                    +
                  </button>
                </div>
              </div>
              <div className="od-serve-chips" role="group" aria-label="Serve mode">
                {SERVE_MODES.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    className={`od-serve-chip${serveMode === m.id ? " is-active" : ""}`}
                    onClick={() => {
                      ensureOrderKey();
                      setServeMode(m.id);
                    }}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="od-ticket-body">
              {sentItemCount > 0 && (
                <div className="od-sent">
                  <button
                    type="button"
                    className="od-sent-toggle"
                    onClick={() => setSentOpen((o) => !o)}
                  >
                    {sentOpen ? "▾" : "▸"} Sent ({sentItemCount})
                  </button>
                  {sentOpen && (
                    <div className="od-sent-list">
                      {sentForTable.flatMap((t) =>
                        t.items.map((item) => (
                          <div key={`${t.id}-${item.id}`} className="od-sent-line">
                            {item.qty} × {item.name}
                            {item.notes ? ` · ${item.notes}` : ""}
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>
              )}

              {lines.length === 0 && (
                <p className="od-ticket-empty">Tap items to build the ticket</p>
              )}

              {groupedLines.map((group) => (
                <div key={group.id}>
                  <div className="od-course-head">{group.label}</div>
                  {group.lines.map((line) => {
                    const unavailable = highlightIds.includes(line.menuItemId);
                    return (
                      <div
                        key={line.key}
                        className={`od-line${unavailable ? " is-unavailable" : ""}`}
                      >
                        <div className="od-line-main">
                          <span className="od-line-qty">{line.qty}×</span>
                          <div className="od-line-copy">
                            <div className="od-line-name-row">
                              <span className="od-line-name">{line.name}</span>
                              <span className="od-line-price">
                                {formatPrice(line.pricePence * line.qty)}
                              </span>
                            </div>
                            {line.notes ? (
                              <div className="od-line-notes">{line.notes}</div>
                            ) : null}
                          </div>
                        </div>
                        <div className="od-line-tools">
                          <button
                            type="button"
                            className="od-line-chip"
                            onClick={() => openNoteSheet(line)}
                          >
                            Note
                          </button>
                          <button
                            type="button"
                            className="od-line-chip"
                            onClick={() => cycleLineCourse(line.key)}
                          >
                            {courseLabel(line.course)}
                          </button>
                          <button
                            type="button"
                            className="od-line-chip is-danger"
                            onClick={() => updateLineQty(line.key, -1)}
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>

            <div className="od-ticket-footer">
              <div className="od-ticket-footer-meta">
                <span>
                  {lineCount} item{lineCount === 1 ? "" : "s"}
                </span>
                <span className="od-ticket-total">{formatPrice(ticketTotal)}</span>
              </div>
              <button
                type="button"
                className="od-send-btn"
                disabled={lineCount === 0 || sending}
                onClick={() => void sendOrder()}
              >
                {sending ? "Sending…" : "Send to kitchen"}
              </button>
            </div>
          </aside>
        </div>
      )}

      {noteSheet && (
        <div
          className="od-sheet-backdrop"
          onClick={() => setNoteSheet(null)}
          role="presentation"
        >
          <div
            className="od-sheet"
            role="dialog"
            aria-label="Quick notes"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="od-sheet-head">
              <span className="od-sheet-title">Notes</span>
              <button
                type="button"
                className="od-sheet-close"
                aria-label="Cancel"
                onClick={() => setNoteSheet(null)}
              >
                ×
              </button>
            </div>
            <div className="od-quick-chips">
              {quickNotes.map((note) => {
                if (note === "Custom") {
                  return (
                    <button
                      key={note}
                      type="button"
                      className={`od-quick-chip${noteSheet.showCustom ? " is-active" : ""}`}
                      onClick={() =>
                        setNoteSheet((s) =>
                          s ? { ...s, showCustom: !s.showCustom } : s
                        )
                      }
                    >
                      Custom
                    </button>
                  );
                }
                const active = noteSheet.selected.includes(note);
                return (
                  <button
                    key={note}
                    type="button"
                    className={`od-quick-chip${active ? " is-active" : ""}`}
                    onClick={() =>
                      setNoteSheet((s) => {
                        if (!s) return s;
                        const selected = active
                          ? s.selected.filter((n) => n !== note)
                          : [...s.selected, note];
                        return { ...s, selected };
                      })
                    }
                  >
                    {note}
                  </button>
                );
              })}
            </div>
            {noteSheet.showCustom && (
              <input
                className="od-custom-field"
                value={noteSheet.custom}
                placeholder="Custom note"
                onChange={(e) =>
                  setNoteSheet((s) =>
                    s ? { ...s, custom: e.target.value } : s
                  )
                }
                autoFocus
              />
            )}
            <button
              type="button"
              className="od-sheet-save"
              onClick={saveNotes}
            >
              Save notes
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
