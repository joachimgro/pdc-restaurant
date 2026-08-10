"use client";

import { useMemo } from "react";
import { useServiceConsole } from "../store/service-console-store";

function shiftDate(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

function weekdayShort(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, {
    weekday: "short",
    timeZone: "UTC",
  });
}

function dayNum(iso: string): string {
  return iso.slice(8, 10).replace(/^0/, "");
}

/** Prev/next day and a compact week strip — shared across Today, Floor, Calendar. */
export function DateNavStrip({ compact }: { compact?: boolean }) {
  const serviceDate = useServiceConsole((s) => s.serviceDate);
  const setDate = useServiceConsole((s) => s.setDate);

  const weekDays = useMemo(() => {
    const start = shiftDate(serviceDate, -3);
    return Array.from({ length: 7 }, (_, i) => shiftDate(start, i));
  }, [serviceDate]);

  const todayIso = useMemo(() => new Date().toISOString().slice(0, 10), []);

  return (
    <div className={`sc-date-nav${compact ? " is-compact" : ""}`}>
      <div className="sc-date-nav-arrows">
        <button
          type="button"
          className="sc-date-nav-btn"
          aria-label="Previous day"
          onClick={() => void setDate(shiftDate(serviceDate, -1))}
        >
          ‹
        </button>
        <button
          type="button"
          className="sc-date-nav-btn"
          aria-label="Next day"
          onClick={() => void setDate(shiftDate(serviceDate, 1))}
        >
          ›
        </button>
        {serviceDate !== todayIso && (
          <button
            type="button"
            className="sc-action sc-date-nav-today"
            onClick={() => void setDate(todayIso)}
          >
            Today
          </button>
        )}
      </div>

      <div className="sc-week-strip" role="group" aria-label="Week">
        {weekDays.map((iso) => {
          const active = iso === serviceDate;
          const isToday = iso === todayIso;
          return (
            <button
              key={iso}
              type="button"
              className={`sc-week-day${active ? " is-active" : ""}${isToday ? " is-today" : ""}`}
              aria-pressed={active}
              aria-label={iso}
              onClick={() => void setDate(iso)}
            >
              <span className="sc-week-day-label">{weekdayShort(iso)}</span>
              <span className="sc-week-day-num fp-num">{dayNum(iso)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
