"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchServiceStats, type ServiceStats } from "../api/console";

type Preset = "today" | 7 | 28 | 90;

function shiftDate(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

function formatPct(value: number | null): string {
  if (value === null) return "—";
  return `${Math.round(value * 100)}%`;
}

function formatMinutes(value: number | null): string {
  if (value === null || Number.isNaN(value)) return "—";
  return `${Math.round(value)}m`;
}

function formatNum(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function formatRangeLabel(from: string, to: string, preset: Preset): string {
  if (preset === "today" || from === to) {
    const [y, m, d] = from.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, {
      weekday: "short",
      day: "numeric",
      month: "short",
      timeZone: "UTC",
    });
  }
  return `${from} → ${to}`;
}

const PRESETS: { id: Preset; label: string }[] = [
  { id: "today", label: "Today" },
  { id: 7, label: "7 days" },
  { id: 28, label: "28 days" },
  { id: 90, label: "90 days" },
];

/**
 * Service analytics — Today first, glanceable hero, details on demand.
 */
export function StatsView() {
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [preset, setPreset] = useState<Preset>("today");
  const [stats, setStats] = useState<ServiceStats | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);

  const range = useMemo(() => {
    const to = today;
    if (preset === "today") return { from: to, to };
    return { from: shiftDate(to, -(preset - 1)), to };
  }, [preset, today]);

  const load = useCallback(async () => {
    setStatus("loading");
    setError(null);
    const result = await fetchServiceStats(range.from, range.to);
    if (!result.ok) {
      setStatus("error");
      setError(result.error);
      return;
    }
    setStats(result.data);
    setStatus("ready");
  }, [range.from, range.to]);

  useEffect(() => {
    void load();
  }, [load]);

  const maxHourly = useMemo(() => {
    if (!stats?.hourlyStarts.length) return 1;
    return Math.max(...stats.hourlyStarts.map((h) => h.covers), 1);
  }, [stats]);

  const isToday = preset === "today";

  return (
    <section className="sc-stats" aria-label="Service statistics">
      <header className="sc-stats-head">
        <div>
          <h3 className="sc-cal-title">Stats</h3>
          {status === "ready" && stats && (
            <p className="sc-stats-sub fp-num">
              {formatRangeLabel(stats.from, stats.to, preset)}
            </p>
          )}
        </div>
        <div className="sc-stats-presets" role="group" aria-label="Date range">
          {PRESETS.map((p) => (
            <button
              key={String(p.id)}
              type="button"
              className={`sc-tab${preset === p.id ? " is-active" : ""}`}
              onClick={() => setPreset(p.id)}
            >
              {p.label}
            </button>
          ))}
        </div>
      </header>

      {status === "loading" && <p className="sc-empty">Loading stats…</p>}
      {status === "error" && (
        <div className="sc-empty">
          <p>{error}</p>
          <button type="button" className="sc-action" onClick={() => void load()}>
            Try again
          </button>
        </div>
      )}

      {status === "ready" && stats && (
        <div className="sc-stats-body">
          <dl className="sc-stats-hero" aria-label="At a glance">
            <HeroStat label="Covers" value={String(stats.covers)} />
            <HeroStat label="Bookings" value={String(stats.bookings)} />
            <HeroStat
              label={isToday ? "Seat wait" : "Avg seat wait"}
              value={formatMinutes(stats.avgSeatLagMinutes)}
            />
            <HeroStat label="No-show" value={formatPct(stats.noShowRate)} />
          </dl>

          <div className="sc-stats-snapshot">
            <Row label="Finished" value={String(stats.finished)} />
            <Row label="Avg party" value={formatNum(stats.avgPartySize)} />
            {isToday && (
              <Row label="Seated now" value={String(stats.seatedNow)} />
            )}
            <Row
              label="Time at table"
              value={formatMinutes(stats.avgDwellMinutes)}
            />
            <Row label="Turn time" value={formatMinutes(stats.avgTurnMinutes)} />
            <Row
              label="Cancelled"
              value={`${stats.cancelled} (${formatPct(stats.cancelRate)})`}
            />
            {stats.waitlistTotal > 0 && (
              <Row
                label="Waitlist seated"
                value={`${stats.waitlistConverted}/${stats.waitlistTotal} (${formatPct(stats.waitlistConversion)})`}
              />
            )}
            {stats.kitchenTickets > 0 && (
              <Row
                label="Kitchen tickets"
                value={`${stats.kitchenTickets} · ${formatMinutes(stats.avgTicketMinutes)} avg · ${stats.ticketsOver15Min} slow`}
              />
            )}
          </div>

          <details className="sc-stats-fold" open={isToday}>
            <summary>Covers by hour</summary>
            {stats.hourlyStarts.length === 0 ? (
              <p className="sc-empty">No bookings in this range.</p>
            ) : (
              <ul className="sc-stats-hours" aria-label="Hourly covers">
                {stats.hourlyStarts.map((h) => (
                  <li key={h.hour} className="sc-stats-hour">
                    <span className="sc-stats-hour-label fp-num">
                      {String(h.hour).padStart(2, "0")}:00
                    </span>
                    <span className="sc-stats-hour-track">
                      <span
                        className="sc-stats-hour-bar"
                        style={{
                          width: `${Math.max(6, (h.covers / maxHourly) * 100)}%`,
                        }}
                      />
                    </span>
                    <span className="sc-stats-hour-val fp-num">{h.covers}</span>
                  </li>
                ))}
              </ul>
            )}
          </details>

          <details className="sc-stats-fold">
            <summary>Booking sources</summary>
            {stats.sourceMix.length === 0 ? (
              <p className="sc-empty">No bookings in this range.</p>
            ) : (
              <ul className="sc-stats-sources">
                {stats.sourceMix.map((row) => {
                  const total = stats.sourceMix.reduce((a, r) => a + r.count, 0);
                  const pct = total > 0 ? Math.round((row.count / total) * 100) : 0;
                  return (
                    <li key={row.source} className="sc-stats-source">
                      <span>{row.source.replace(/_/g, " ")}</span>
                      <span className="sc-stats-source-vals fp-num">
                        {row.count}
                        <span className="sc-stats-source-pct">{pct}%</span>
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </details>
        </div>
      )}
    </section>
  );
}

function HeroStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="sc-stats-hero-item">
      <dt>{label}</dt>
      <dd className="fp-num">{value}</dd>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="sc-stats-row">
      <span className="sc-stats-row-label">{label}</span>
      <span className="sc-stats-row-value fp-num">{value}</span>
    </div>
  );
}
