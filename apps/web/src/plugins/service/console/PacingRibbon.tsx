"use client";

import { useMemo } from "react";
import { formatHHMM, occupies, pacingBuckets, parseHHMM } from "./status";
import {
  selectReservationList,
  useServiceConsole,
} from "../store/service-console-store";

/**
 * Covers per interval across the shift, as filled bars against the pacing cap.
 *
 * Read-only for now: the drag-to-edit control that writes max_covers back is
 * deliberately deferred. Pacing counts bookings by start-time bucket, not
 * occupancy — it exists to protect the kitchen from simultaneous orders, so a
 * party still sitting at 21:00 does not count against the 21:00 bucket.
 */
export function PacingRibbon() {
  const reservations = useServiceConsole(selectReservationList);
  const day = useServiceConsole((s) => s.day);
  const nowMinutes = useServiceConsole((s) => s.nowMinutes);

  const model = useMemo(() => {
    if (!day || day.periods.length === 0) return null;

    const starts = day.periods.map((p) => parseHHMM(p.startTime));
    const ends = day.periods.map((p) => parseHHMM(p.endTime));
    const from = Math.min(...starts);
    const to = Math.max(...ends);

    const rule =
      day.periods.flatMap((p) => p.pacingRules).find((r) => r.isActive) ??
      day.venuePacingRules.find((r) => r.isActive) ??
      null;

    const intervalMin = rule?.intervalMin ?? 15;
    const buckets = pacingBuckets(reservations, intervalMin, from, to);
    const cap = rule?.maxCovers ?? null;
    const peak = Math.max(1, ...buckets.map((b) => b.covers));

    return { buckets, cap, intervalMin, scale: cap ?? peak, from, to };
  }, [day, reservations]);

  if (!model) return null;

  const liveCovers = reservations
    .filter(occupies)
    .reduce((sum, r) => sum + r.partySize, 0);

  return (
    <section
      className="sc-ribbon"
      aria-label={`Pacing: ${liveCovers} covers across the shift, ${model.intervalMin} minute intervals`}
    >
      <ol className="sc-ribbon-track">
        {model.buckets.map((bucket) => {
          const ratio = Math.min(1, bucket.covers / model.scale);
          const over = model.cap !== null && bucket.covers > model.cap;
          const isNow =
            nowMinutes >= bucket.start &&
            nowMinutes < bucket.start + model.intervalMin;

          return (
            <li
              key={bucket.start}
              className={`sc-ribbon-bucket${over ? " is-over" : ""}${
                isNow ? " is-now" : ""
              }`}
              /* Text, not colour: the count and cap are readable on hover and
                 exposed to assistive tech. */
              title={`${formatHHMM(bucket.start)} — ${bucket.covers} covers${
                model.cap !== null ? ` of ${model.cap}` : ""
              }, ${bucket.bookings} bookings`}
            >
              <span
                className="sc-ribbon-fill"
                style={{ height: `${Math.round(ratio * 100)}%` }}
              />
              <span className="sc-sr-only">
                {formatHHMM(bucket.start)}: {bucket.covers} covers
                {model.cap !== null ? ` of ${model.cap}` : ""}
              </span>
            </li>
          );
        })}
      </ol>
      <div className="sc-ribbon-axis fp-num">
        <span>{formatHHMM(model.from)}</span>
        {model.cap !== null && (
          <span className="sc-ribbon-cap">cap {model.cap} / {model.intervalMin}m</span>
        )}
        <span>{formatHHMM(model.to)}</span>
      </div>
    </section>
  );
}
