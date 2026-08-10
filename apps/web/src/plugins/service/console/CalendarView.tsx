"use client";

import { useEffect, useMemo, useRef } from "react";
import { DateNavStrip } from "./DateNavStrip";
import { occupies, parseHHMM, STATUS_META, deriveTableStatus } from "./status";
import {
  formatTimeRange,
  hourLabelsBetween,
  HOUR_WIDTH_PX,
  LANE_HEIGHT_PX,
  layoutSwimlanes,
} from "./calendar-layout";
import {
  selectReservationList,
  useServiceConsole,
} from "../store/service-console-store";

/**
 * Day calendar with time across the top (Anthem / timeline style).
 * Concurrent bookings stack in lanes so every guest stays readable.
 */
export function CalendarView() {
  const reservations = useServiceConsole(selectReservationList);
  const day = useServiceConsole((s) => s.day);
  const serviceDate = useServiceConsole((s) => s.serviceDate);
  const select = useServiceConsole((s) => s.select);
  const selectedId = useServiceConsole((s) => s.selectedId);
  const nowMinutes = useServiceConsole((s) => s.nowMinutes);
  const scrollRef = useRef<HTMLDivElement>(null);
  const didScroll = useRef(false);

  const live = useMemo(
    () =>
      reservations
        .filter(occupies)
        .sort(
          (a, b) =>
            a.startTime.localeCompare(b.startTime) ||
            a.guestName.localeCompare(b.guestName)
        ),
    [reservations]
  );

  const bounds = useMemo(() => {
    const bookingMins = live.flatMap((r) => [
      parseHHMM(r.startTime),
      parseHHMM(r.endTime),
    ]);
    const periodFrom =
      day && day.periods.length > 0
        ? Math.min(...day.periods.map((p) => parseHHMM(p.startTime)))
        : null;
    const periodTo =
      day && day.periods.length > 0
        ? Math.max(...day.periods.map((p) => parseHHMM(p.endTime)))
        : null;

    const rawFrom =
      bookingMins.length > 0
        ? Math.min(...bookingMins, periodFrom ?? Infinity)
        : (periodFrom ?? 11 * 60);
    const rawTo =
      bookingMins.length > 0
        ? Math.max(...bookingMins, periodTo ?? 0)
        : (periodTo ?? 23 * 60);

    return {
      from: Math.max(0, Math.floor(rawFrom / 60) * 60),
      to: Math.min(24 * 60, Math.ceil(rawTo / 60) * 60),
    };
  }, [day, live]);

  const { items, laneCount } = useMemo(
    () => layoutSwimlanes(live, bounds.from),
    [live, bounds.from]
  );

  const hours = useMemo(
    () => hourLabelsBetween(bounds.from, bounds.to),
    [bounds]
  );

  const gridWidth = Math.max(
    ((bounds.to - bounds.from) / 60) * HOUR_WIDTH_PX,
    HOUR_WIDTH_PX * 4
  );
  const gridHeight = Math.max(laneCount, 1) * LANE_HEIGHT_PX + 8;

  const todayIso = useMemo(() => {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const dayNum = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${dayNum}`;
  }, []);

  const isToday = serviceDate === todayIso;
  const showNow =
    isToday && nowMinutes >= bounds.from && nowMinutes <= bounds.to;
  const nowLeft = ((nowMinutes - bounds.from) / 60) * HOUR_WIDTH_PX;

  useEffect(() => {
    didScroll.current = false;
  }, [serviceDate]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || didScroll.current) return;
    didScroll.current = true;

    let targetLeft = 0;
    if (showNow) {
      targetLeft = Math.max(0, nowLeft - el.clientWidth / 3);
    } else if (live[0]) {
      const first = parseHHMM(live[0].startTime);
      targetLeft = Math.max(
        0,
        ((first - bounds.from) / 60) * HOUR_WIDTH_PX - 40
      );
    }
    el.scrollLeft = targetLeft;
  }, [serviceDate, showNow, nowLeft, live, bounds.from]);

  return (
    <section className="sc-cal" aria-label="Day calendar">
      <header className="sc-cal-head">
        <div className="sc-cal-head-row">
          <h3 className="sc-cal-title">Day view</h3>
          <DateNavStrip compact />
        </div>
        <p className="sc-cal-sub">
          {live.length === 0
            ? "No bookings"
            : `${live.length} booking${live.length === 1 ? "" : "s"} · time runs across`}
        </p>
      </header>

      {live.length === 0 ? (
        <p className="sc-empty">No bookings on this day.</p>
      ) : (
        <div className="sc-cal-scroll" ref={scrollRef}>
          <div className="sc-cal-grid" style={{ width: gridWidth + 8 }}>
            <div
              className="sc-cal-times"
              style={{
                gridTemplateColumns: `repeat(${hours.length}, ${HOUR_WIDTH_PX}px)`,
              }}
              aria-hidden="true"
            >
              {hours.map((label, i) => (
                <div key={`${label}-${i}`} className="sc-cal-time fp-num">
                  {label}
                </div>
              ))}
            </div>

            <div
              className="sc-cal-lanes"
              style={{
                height: gridHeight,
                width: gridWidth,
                backgroundSize: `${HOUR_WIDTH_PX}px 100%`,
              }}
            >
              {hours.map((_, i) => (
                <div
                  key={i}
                  className="sc-cal-vline"
                  style={{ left: i * HOUR_WIDTH_PX }}
                />
              ))}

              {items.map((ev) => {
                const status = deriveTableStatus({
                  reservation: ev.reservation,
                  nowMinutes,
                });
                const tables = ev.reservation.tableIds.length
                  ? ev.reservation.tableIds
                      .map((t) => t.replace(/^tbl-/, ""))
                      .join(", ")
                  : "—";
                return (
                  <button
                    key={ev.reservation.id}
                    type="button"
                    className={`sc-cal-event sc-cal-event-${status}${
                      selectedId === ev.reservation.id ? " is-active" : ""
                    }`}
                    style={{
                      left: ev.left + 3,
                      width: Math.max(ev.width - 6, 64),
                      top: ev.lane * LANE_HEIGHT_PX + 4,
                      height: LANE_HEIGHT_PX - 8,
                    }}
                    onClick={() => select(ev.reservation.id)}
                    title={`${ev.reservation.guestName} · ${formatTimeRange(
                      ev.reservation.startTime,
                      ev.reservation.endTime
                    )}`}
                  >
                    <span className="sc-cal-event-name">
                      {ev.reservation.guestName}
                    </span>
                    <span className="sc-cal-event-meta">
                      {formatTimeRange(
                        ev.reservation.startTime,
                        ev.reservation.endTime
                      )}{" "}
                      · {ev.reservation.partySize} · {tables}
                    </span>
                    <span className="sc-sr-only">
                      {STATUS_META[status].label}
                    </span>
                  </button>
                );
              })}

              {showNow && (
                <div
                  className="sc-cal-now"
                  style={{ left: nowLeft }}
                  aria-hidden="true"
                >
                  <span className="sc-cal-now-label fp-num">
                    {String(Math.floor(nowMinutes / 60)).padStart(2, "0")}:
                    {String(nowMinutes % 60).padStart(2, "0")}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
