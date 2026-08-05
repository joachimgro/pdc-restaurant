"use client";

import { useEffect, useState } from "react";
import {
  createReservation,
  fetchAvailability,
  type AvailabilitySlotDto,
} from "../api/console";
import { useServiceConsole } from "../store/service-console-store";

/**
 * Taking a booking over the phone — the console's most common write.
 *
 * Never optimistic. A booking that appears on the floor and then vanishes
 * because the server refused it is worse than half a second of waiting, and
 * the guest is on the line.
 */
export function NewBookingPanel({
  presetTableId,
  onClose,
}: {
  presetTableId?: string | null;
  onClose: () => void;
}) {
  const serviceDate = useServiceConsole((s) => s.serviceDate);
  const load = useServiceConsole((s) => s.load);
  const select = useServiceConsole((s) => s.select);

  const [guestName, setGuestName] = useState("");
  const [guestPhone, setGuestPhone] = useState("");
  const [partySize, setPartySize] = useState(2);
  const [slots, setSlots] = useState<AvailabilitySlotDto[]>([]);
  const [startTime, setStartTime] = useState<string | null>(null);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoadingSlots(true);
    void fetchAvailability(serviceDate, partySize).then((result) => {
      if (cancelled) return;
      setLoadingSlots(false);
      if (result.ok) {
        setSlots(result.data.slots);
        setError(null);
      } else {
        setError(result.error);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [serviceDate, partySize]);

  const submit = async () => {
    if (!guestName.trim() || !startTime) return;
    setSubmitting(true);
    setError(null);

    const result = await createReservation({
      guestName: guestName.trim(),
      guestPhone: guestPhone.trim() || null,
      partySize,
      serviceDate,
      startTime,
      source: "phone",
      ...(presetTableId ? { tableIds: [presetTableId] } : {}),
    });

    setSubmitting(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    await load();
    select(result.data.id);
    onClose();
  };

  return (
    <section className="sc-booking" aria-label="New booking">
      <header className="sc-booking-head">
        <h2>New booking</h2>
        <button
          type="button"
          className="sc-icon-btn"
          aria-label="Close new booking"
          onClick={onClose}
        >
          ×
        </button>
      </header>

      {error && (
        <p className="sc-notice sc-notice-error" role="alert">
          {error}
        </p>
      )}

      <div className="sc-field">
        <label htmlFor="sc-guest">Guest name</label>
        <input
          id="sc-guest"
          className="sc-input"
          value={guestName}
          autoComplete="off"
          onChange={(e) => setGuestName(e.target.value)}
        />
      </div>

      <div className="sc-field">
        <label htmlFor="sc-phone">Phone</label>
        <input
          id="sc-phone"
          className="sc-input fp-num"
          type="tel"
          value={guestPhone}
          onChange={(e) => setGuestPhone(e.target.value)}
        />
      </div>

      <div className="sc-field">
        <label htmlFor="sc-party">Party size</label>
        <input
          id="sc-party"
          className="sc-input fp-num"
          type="number"
          min={1}
          max={100}
          value={partySize}
          onChange={(e) =>
            setPartySize(Math.max(1, Number.parseInt(e.target.value, 10) || 1))
          }
        />
      </div>

      <fieldset className="sc-slots">
        <legend>Time</legend>
        {loadingSlots ? (
          <p className="sc-empty">Checking availability</p>
        ) : slots.length === 0 ? (
          <p className="sc-empty">No service on this date.</p>
        ) : (
          <div className="sc-slot-grid">
            {slots.map((slot) => (
              <button
                key={`${slot.periodId}-${slot.time}`}
                type="button"
                className={`sc-slot${startTime === slot.time ? " is-active" : ""}`}
                disabled={!slot.available}
                aria-pressed={startTime === slot.time}
                /* Unavailable slots stay visible with their reason — "why
                   can't I book 8pm" is the question this answers. */
                title={
                  slot.available
                    ? `${slot.time} to ${slot.endTime}`
                    : `Unavailable: ${(slot.reason ?? "").replace(/_/g, " ")}`
                }
                onClick={() => setStartTime(slot.time)}
              >
                <span className="fp-num">{slot.time}</span>
                {!slot.available && (
                  <span className="sc-slot-reason">
                    {(slot.reason ?? "").replace(/_/g, " ")}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </fieldset>

      <button
        type="button"
        className="sc-action sc-action-primary sc-action-wide"
        disabled={submitting || !guestName.trim() || !startTime}
        onClick={() => void submit()}
      >
        {submitting ? "Booking" : "Take booking"}
      </button>
    </section>
  );
}
