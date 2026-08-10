"use client";

import { useMemo } from "react";
import { DateNavStrip } from "./DateNavStrip";
import { occupies } from "./status";
import {
  selectReservationList,
  useServiceConsole,
} from "../store/service-console-store";

/**
 * The shift at a glance. Numbers large, labels small (spec §12).
 *
 * Every figure is derived here from the reservations already in the store —
 * the server deliberately does not send a summary, because computing covers in
 * two places is how the header and the list start disagreeing.
 */
export function HeaderStrip() {
  const reservations = useServiceConsole(selectReservationList);
  const floorPlan = useServiceConsole((s) => s.floorPlan);
  const serviceDate = useServiceConsole((s) => s.serviceDate);
  const setDate = useServiceConsole((s) => s.setDate);

  const stats = useMemo(() => {
    const live = reservations.filter(occupies);
    const capacity = (floorPlan?.rooms ?? [])
      .filter((r) => r.isActive)
      .flatMap((r) => r.tables)
      .filter((t) => t.isActive)
      .reduce((sum, t) => sum + t.seatsMax, 0);

    return {
      covers: live.reduce((sum, r) => sum + r.partySize, 0),
      capacity,
      bookings: live.length,
      unassigned: live.filter((r) => r.tableIds.length === 0).length,
      vips: live.filter((r) => r.tags.includes("vip")).length,
      allergies: live.filter((r) => Boolean(r.allergies?.trim())).length,
    };
  }, [reservations, floorPlan]);

  return (
    <header className="sc-header" aria-label="Service summary">
      <div className="sc-header-date">
        <label className="sc-sr-only" htmlFor="sc-date">
          Service date
        </label>
        <input
          id="sc-date"
          className="sc-date-input fp-num"
          type="date"
          value={serviceDate}
          onChange={(e) => void setDate(e.target.value)}
        />
        <DateNavStrip />
      </div>

      <dl className="sc-metrics">
        <Metric
          label="Covers"
          value={`${stats.covers}`}
          suffix={stats.capacity ? ` / ${stats.capacity}` : undefined}
        />
        <Metric label="Bookings" value={`${stats.bookings}`} />
        <Metric
          label="Unassigned"
          value={`${stats.unassigned}`}
          tone={stats.unassigned > 0 ? "warn" : undefined}
        />
        <Metric label="VIPs" value={`${stats.vips}`} />
        <Metric
          label="Allergies"
          value={`${stats.allergies}`}
          tone={stats.allergies > 0 ? "alert" : undefined}
        />
      </dl>
    </header>
  );
}

function Metric({
  label,
  value,
  suffix,
  tone,
}: {
  label: string;
  value: string;
  suffix?: string;
  tone?: "warn" | "alert";
}) {
  return (
    <div className={`sc-metric${tone ? ` is-${tone}` : ""}`}>
      <dt className="sc-metric-label">{label}</dt>
      <dd className="sc-metric-value fp-num">
        {value}
        {suffix && <span className="sc-metric-suffix">{suffix}</span>}
      </dd>
    </div>
  );
}
