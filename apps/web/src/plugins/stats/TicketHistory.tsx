"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchKitchenTickets,
  type KitchenTicket,
} from "@/plugins/kitchen/api/kitchen";

type Preset = "today" | 7 | 28 | 90 | "all" | "custom";

const PAGE = 50;

const PRESETS: { id: Preset; label: string }[] = [
  { id: "today", label: "Today" },
  { id: 7, label: "7 days" },
  { id: 28, label: "28 days" },
  { id: 90, label: "90 days" },
  { id: "all", label: "All" },
];

function shiftDate(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

function formatClock(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function formatDur(from: string | null | undefined, to: string | null | undefined): string {
  if (!from || !to) return "—";
  const a = Date.parse(from);
  const b = Date.parse(to);
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) return "—";
  const ms = b - a;
  const mins = Math.floor(ms / 60_000);
  const secs = Math.floor((ms % 60_000) / 1000);
  if (mins >= 60) {
    const h = Math.floor(mins / 60);
    return `${h}h ${mins % 60}m`;
  }
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

function statusLabel(status: string): string {
  if (status === "in_progress") return "Cooking";
  if (status === "new") return "New";
  if (status === "ready") return "Pass";
  if (status === "served") return "Picked up";
  if (status === "void") return "Void";
  return status;
}

function itemSummary(ticket: KitchenTicket): string {
  return ticket.items
    .map((i) => (i.qty > 1 ? `${i.qty}× ${i.name}` : i.name))
    .join(", ");
}

export function TicketHistory() {
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [preset, setPreset] = useState<Preset>(7);
  const [from, setFrom] = useState(() => shiftDate(today, -6));
  const [to, setTo] = useState(today);
  const [table, setTable] = useState("");
  const [tableQuery, setTableQuery] = useState("");
  const [tickets, setTickets] = useState<KitchenTicket[]>([]);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    if (preset === "all" || preset === "custom") return;
    if (preset === "today") {
      setFrom(today);
      setTo(today);
      return;
    }
    setFrom(shiftDate(today, -(preset - 1)));
    setTo(today);
  }, [preset, today]);

  const load = useCallback(
    async (offset: number, append: boolean) => {
      setStatus((s) => (append ? s : "loading"));
      setError(null);
      const result = await fetchKitchenTickets(undefined, undefined, {
        from: preset === "all" ? undefined : from,
        to: preset === "all" ? undefined : to,
        table: tableQuery || undefined,
        order: "desc",
        limit: PAGE,
        offset,
      });
      if (!result.ok) {
        setStatus("error");
        setError(result.error);
        return;
      }
      setTotal(result.data.total ?? result.data.tickets.length);
      setTickets((prev) =>
        append ? [...prev, ...result.data.tickets] : result.data.tickets
      );
      setStatus("ready");
    },
    [from, to, preset, tableQuery]
  );

  useEffect(() => {
    void load(0, false);
  }, [load]);

  const grouped = useMemo(() => {
    const map = new Map<string, KitchenTicket[]>();
    for (const t of tickets) {
      const day = t.createdAt.slice(0, 10);
      const list = map.get(day) ?? [];
      list.push(t);
      map.set(day, list);
    }
    return [...map.entries()];
  }, [tickets]);

  return (
    <section className="st-hist" aria-label="Order history">
      <header className="st-hist-head">
        <div>
          <h3 className="st-hist-title">Order history</h3>
          <p className="st-hist-sub">
            Kitchen and pass times for every ticket. Go back as far as you need.
          </p>
        </div>
      </header>

      <div className="st-hist-filters">
        <div className="st-hist-presets" role="group" aria-label="Date range">
          {PRESETS.map((p) => (
            <button
              key={String(p.id)}
              type="button"
              className={`st-hist-chip${preset === p.id ? " is-active" : ""}`}
              onClick={() => setPreset(p.id)}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="st-hist-dates">
          <label className="st-hist-date">
            From
            <input
              type="date"
              value={from}
              max={to}
              onChange={(e) => {
                setPreset("custom");
                setFrom(e.target.value);
              }}
            />
          </label>
          <label className="st-hist-date">
            To
            <input
              type="date"
              value={to}
              max={today}
              onChange={(e) => {
                setPreset("custom");
                setTo(e.target.value);
              }}
            />
          </label>
          <form
            className="st-hist-search"
            onSubmit={(e) => {
              e.preventDefault();
              setTableQuery(table.trim());
            }}
          >
            <input
              type="search"
              value={table}
              onChange={(e) => setTable(e.target.value)}
              placeholder="Table"
              aria-label="Filter by table"
            />
            <button type="submit" className="st-hist-chip">
              Search
            </button>
          </form>
        </div>
      </div>

      {status === "loading" && <p className="st-hist-empty">Loading tickets…</p>}
      {status === "error" && (
        <div className="st-hist-empty">
          <p>{error}</p>
          <button
            type="button"
            className="st-hist-chip"
            onClick={() => void load(0, false)}
          >
            Try again
          </button>
        </div>
      )}

      {status === "ready" && tickets.length === 0 && (
        <p className="st-hist-empty">No tickets in this range.</p>
      )}

      {status !== "loading" && tickets.length > 0 && (
        <>
          <p className="st-hist-count">
            Showing {tickets.length} of {total}
          </p>
          {grouped.map(([day, rows]) => (
            <div key={day} className="st-hist-day">
              <h4 className="st-hist-day-label">
                {new Date(`${day}T12:00:00.000Z`).toLocaleDateString(undefined, {
                  weekday: "short",
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                  timeZone: "UTC",
                })}
              </h4>
              <ul className="st-hist-list">
                {rows.map((t) => {
                  const open = openId === t.id;
                  const kitchen = formatDur(t.createdAt, t.readyAt);
                  const pass = formatDur(t.readyAt, t.servedAt);
                  const totalTime = formatDur(
                    t.createdAt,
                    t.servedAt ?? (t.status === "void" ? t.updatedAt : null)
                  );
                  return (
                    <li key={t.id}>
                      <button
                        type="button"
                        className={`st-hist-row${open ? " is-open" : ""}`}
                        onClick={() =>
                          setOpenId((id) => (id === t.id ? null : t.id))
                        }
                      >
                        <span className="st-hist-when">
                          {formatClock(t.createdAt)}
                        </span>
                        <span className="st-hist-table">
                          {t.tableLabel?.trim() || "Walk-in"}
                        </span>
                        <span className="st-hist-station">{t.station}</span>
                        <span className={`st-hist-status is-${t.status}`}>
                          {statusLabel(t.status)}
                        </span>
                        <span className="st-hist-times">
                          <span>Kitchen {kitchen}</span>
                          <span>Pass {pass}</span>
                          <span>Total {totalTime}</span>
                        </span>
                      </button>
                      {open && (
                        <div className="st-hist-detail">
                          <p className="st-hist-items">{itemSummary(t) || "No items"}</p>
                          {t.items.map((item) => (
                            <div key={item.id} className="st-hist-item">
                              <span>
                                {item.qty}× {item.name}
                              </span>
                              {item.notes ? (
                                <span className="st-hist-notes">{item.notes}</span>
                              ) : null}
                            </div>
                          ))}
                          <dl className="st-hist-stamps">
                            <div>
                              <dt>Sent</dt>
                              <dd>{formatClock(t.createdAt)}</dd>
                            </div>
                            <div>
                              <dt>Ready</dt>
                              <dd>
                                {t.readyAt ? formatClock(t.readyAt) : "—"}
                              </dd>
                            </div>
                            <div>
                              <dt>Picked up</dt>
                              <dd>
                                {t.servedAt ? formatClock(t.servedAt) : "—"}
                              </dd>
                            </div>
                          </dl>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
          {tickets.length < total && (
            <button
              type="button"
              className="st-hist-more"
              onClick={() => void load(tickets.length, true)}
            >
              Load earlier tickets
            </button>
          )}
        </>
      )}
    </section>
  );
}
