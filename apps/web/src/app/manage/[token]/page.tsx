"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { getManageBooking, postManageCancel } from "@/lib/api/book";
import "@/app/book/book.css";

function formatDayLabel(date: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
  const [y, m, d] = date.split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

export default function ManageBookingPage() {
  const params = useParams<{ token: string }>();
  const token = params.token;
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
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
    setBusy(true);
    try {
      await postManageCancel(token);
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not cancel");
    } finally {
      setBusy(false);
    }
  }

  if (error && !data) {
    return (
      <div className="book-page">
        <main className="book-shell">
          <div className="book-body">
            <p className="book-error">{error}</p>
          </div>
        </main>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="book-page">
        <main className="book-shell">
          <div className="book-loading">
            <div className="book-spinner" aria-hidden />
            <p>Loading booking…</p>
          </div>
        </main>
      </div>
    );
  }

  const r = data.reservation;
  const venueName = data.venue?.name ?? "Restaurant";
  const initial = venueName.charAt(0).toUpperCase();
  const cancelled = done || r.status === "cancelled";

  return (
    <div className="book-page">
      <main className="book-shell">
        <header className="book-header">
          <div className="book-brand-row">
            <div className="book-logo" aria-hidden>
              {initial}
            </div>
            <div>
              <p className="book-brand">{venueName}</p>
              <p className="book-brand-sub">
                {cancelled ? "Booking cancelled" : "Your booking"}
              </p>
            </div>
          </div>
        </header>

        <div className="book-body">
          {error ? (
            <p className="book-error" role="alert">
              {error}
            </p>
          ) : null}

          {cancelled ? (
            <section className="book-step book-confirmed">
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
              <div className="book-summary">
                <span className="book-pill">{r.partySize} guests</span>
                <span className="book-pill">{formatDayLabel(r.serviceDate)}</span>
                <span className="book-pill">{r.startTime}</span>
              </div>
              <h1>Hi {r.guestName}</h1>
              <p className="book-support">Here&apos;s your table.</p>
              <p className="book-ref">{r.reference}</p>
              {data.venue?.addressText ? (
                <p className="book-muted" style={{ marginBottom: 8 }}>
                  {data.venue.addressText}
                </p>
              ) : null}
            </section>
          )}
        </div>

        {!cancelled && data.actions.canCancel ? (
          <div className="book-footer">
            <button
              type="button"
              className="book-cta is-secondary"
              disabled={busy}
              onClick={() => void cancel()}
            >
              {busy ? "Cancelling…" : "Cancel booking"}
            </button>
          </div>
        ) : null}
      </main>
    </div>
  );
}
