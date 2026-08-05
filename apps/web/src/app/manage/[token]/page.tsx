"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { getManageBooking, postManageCancel } from "@/lib/api/book";
import "../book/[slug]/book.css";

export default function ManageBookingPage() {
  const params = useParams<{ token: string }>();
  const token = params.token;
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [data, setData] = useState<Awaited<ReturnType<typeof getManageBooking>> | null>(
    null
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await getManageBooking(token);
        if (!cancelled) setData(res);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Link invalid");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function cancel() {
    setError(null);
    try {
      await postManageCancel(token);
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not cancel");
    }
  }

  if (error && !data) {
    return (
      <main className="book-shell">
        <p className="book-error">{error}</p>
      </main>
    );
  }

  if (!data) {
    return (
      <main className="book-shell">
        <p className="book-muted">Loading…</p>
      </main>
    );
  }

  const r = data.reservation;
  const venueName = data.venue?.name ?? "Restaurant";

  return (
    <main className="book-shell">
      <header className="book-header">
        <p className="book-brand">{venueName}</p>
      </header>

      {error ? <p className="book-error">{error}</p> : null}

      {done || r.status === "cancelled" ? (
        <section className="book-step">
          <h1>Booking cancelled</h1>
          <p className="book-support">
            Reference {r.reference} is cancelled. We hope to see you another time.
          </p>
          {data.venue?.contactPhone ? (
            <p className="book-muted">
              Questions?{" "}
              <a href={`tel:${data.venue.contactPhone}`}>{data.venue.contactPhone}</a>
            </p>
          ) : null}
        </section>
      ) : (
        <section className="book-step">
          <h1>Your booking</h1>
          <p className="book-support">
            {r.partySize} on {r.serviceDate} at {r.startTime}
          </p>
          <p className="book-ref">Reference {r.reference}</p>
          {data.venue?.addressText ? (
            <p className="book-muted">{data.venue.addressText}</p>
          ) : null}

          {data.actions.canCancel ? (
            <button type="button" className="book-cta" onClick={() => void cancel()}>
              Cancel booking
            </button>
          ) : (
            <p className="book-muted">This booking can&apos;t be changed online.</p>
          )}
        </section>
      )}
    </main>
  );
}
