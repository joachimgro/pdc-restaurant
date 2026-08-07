"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import {
  getBookAvailability,
  getBookDays,
  getBookVenue,
  postBookHold,
  postBookReserve,
  type BookVenue,
} from "@/lib/api/book";
import "../../../globals.css";
import "./book.css";

type Step = "party" | "date" | "time" | "details" | "confirmed";

const FLOW_STEPS: Step[] = ["party", "date", "time", "details"];

function todayISO(timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function addDaysISO(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

function formatDayLabel(date: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
  const [y, m, d] = date.split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

function formatDayParts(date: string): { title: string; meta: string } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { title: date, meta: "" };
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return {
    title: new Intl.DateTimeFormat("en-GB", {
      weekday: "long",
      day: "numeric",
      month: "long",
    }).format(dt),
    meta: new Intl.DateTimeFormat("en-GB", { year: "numeric" }).format(dt),
  };
}

export default function BookClient() {
  const params = useParams<{ slug: string }>();
  const slug = params.slug;
  const search = useSearchParams();
  const router = useRouter();
  const [, startTransition] = useTransition();

  const step = (search.get("step") as Step) || "party";
  const party = Number(search.get("party") || "2");
  const date = search.get("date") || "";
  const time = search.get("time") || "";

  const [venue, setVenue] = useState<BookVenue | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [softExit, setSoftExit] = useState<string | null>(null);
  const [daysLoading, setDaysLoading] = useState(false);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [days, setDays] = useState<
    Array<{ date: string; available: boolean; slotCount: number }>
  >([]);
  const [slots, setSlots] = useState<Array<{ time: string }>>([]);
  const [confirmed, setConfirmed] = useState<{
    reference: string;
    manageUrl: string | null;
    serviceDate: string;
    startTime: string;
    partySize: number;
  } | null>(null);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");

  const setQuery = useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(search.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v === null || v === "") next.delete(k);
        else next.set(k, v);
      }
      startTransition(() => {
        router.replace(`?${next.toString()}`, { scroll: false });
      });
    },
    [router, search]
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const v = await getBookVenue(slug);
        if (!cancelled) setVenue(v);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Venue not found");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  useEffect(() => {
    if (!venue || step !== "date") return;
    const from = todayISO(venue.timezone);
    const to = addDaysISO(from, 21);
    let cancelled = false;
    setDaysLoading(true);
    (async () => {
      try {
        const res = await getBookDays(slug, { party, from, to });
        if (!cancelled) setDays(res.days);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not load days");
      } finally {
        if (!cancelled) setDaysLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [venue, step, slug, party]);

  useEffect(() => {
    if (!venue || step !== "time" || !date) return;
    let cancelled = false;
    setSlotsLoading(true);
    (async () => {
      try {
        const res = await getBookAvailability(slug, { date, party });
        if (cancelled) return;
        setSlots(res.slots);
        setSoftExit(res.softExit);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not load times");
      } finally {
        if (!cancelled) setSlotsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [venue, step, slug, date, party]);

  const stepIndex = useMemo(() => {
    if (step === "confirmed") return FLOW_STEPS.length;
    const i = FLOW_STEPS.indexOf(step);
    return i < 0 ? 0 : i;
  }, [step]);

  async function submitDetails() {
    setError(null);
    if (!name.trim()) {
      setError("What's your name?");
      return;
    }
    if (!email.trim()) {
      setError("Leave an email so we can send your confirmation");
      return;
    }
    setSubmitting(true);
    try {
      const hold = await postBookHold(slug, {
        partySize: party,
        serviceDate: date,
        startTime: time,
      });
      const idem = crypto.randomUUID();
      const reserved = await postBookReserve(
        slug,
        {
          holdToken: hold.holdToken,
          guestName: name.trim(),
          guestEmail: email.trim() || undefined,
          guestPhone: phone.trim() || undefined,
          guestNotes: notes.trim() || undefined,
        },
        idem
      );
      setConfirmed({
        reference: reserved.reservation.reference,
        manageUrl: reserved.manageUrl,
        serviceDate: reserved.reservation.serviceDate,
        startTime: reserved.reservation.startTime,
        partySize: reserved.reservation.partySize,
      });
      setQuery({ step: "confirmed" });
    } catch (e) {
      const err = e as Error & { code?: string };
      if (err.code === "SLOT_TAKEN" || err.code === "HOLD_EXPIRED") {
        setSoftExit("day_full");
        setError("That time just went — pick another");
        setQuery({ step: "time", time: null });
        return;
      }
      setError(err.message || "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  const initial = venue?.name?.charAt(0)?.toUpperCase() || "R";

  if (error && !venue) {
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

  if (!venue) {
    return (
      <div className="book-page">
        <main className="book-shell">
          <div className="book-loading">
            <div className="book-spinner" aria-hidden />
            <p>Loading…</p>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="book-page">
      <main className="book-shell">
        <header className="book-header">
          <div className="book-brand-row">
            <div className="book-logo" aria-hidden>
              {initial}
            </div>
            <div>
              <p className="book-brand">{venue.name}</p>
              <p className="book-brand-sub">Book a table</p>
            </div>
          </div>
          {step !== "confirmed" ? (
            <div className="book-steps" aria-label="Progress">
              {FLOW_STEPS.map((s, i) => (
                <div
                  key={s}
                  className={`book-step-dot ${
                    i < stepIndex ? "is-done" : i === stepIndex ? "is-current" : ""
                  }`}
                />
              ))}
            </div>
          ) : null}
        </header>

        <div className="book-body">
          {error ? (
            <p className="book-error" role="alert">
              {error}
            </p>
          ) : null}

          {step !== "party" && step !== "confirmed" ? (
            <div className="book-summary">
              <span className="book-pill">{party} guests</span>
              {date ? <span className="book-pill">{formatDayLabel(date)}</span> : null}
              {time ? <span className="book-pill">{time}</span> : null}
            </div>
          ) : null}

          {step === "party" && (
            <section className="book-step">
              <h1>How many of you?</h1>
              <p className="book-support">We&apos;ll find a table that fits.</p>
              <div className="book-party-grid">
                {Array.from(
                  { length: venue.maxParty - venue.minParty + 1 },
                  (_, i) => venue.minParty + i
                ).map((n) => (
                  <button
                    key={n}
                    type="button"
                    className={`book-chip ${party === n ? "is-active" : ""}`}
                    onClick={() => setQuery({ party: String(n), step: "date" })}
                  >
                    {n}
                  </button>
                ))}
              </div>
              {venue.largePartyMessage ? (
                <p className="book-muted book-soft">
                  Larger party? {venue.largePartyMessage}
                  {venue.contactPhone ? (
                    <>
                      {" "}
                      <a href={`tel:${venue.contactPhone}`}>{venue.contactPhone}</a>
                    </>
                  ) : null}
                </p>
              ) : null}
            </section>
          )}

          {step === "date" && (
            <section className="book-step">
              <button
                type="button"
                className="book-back"
                onClick={() => setQuery({ step: "party" })}
              >
                ← Back
              </button>
              <h1>Which day?</h1>
              <p className="book-support">Party of {party}</p>
              {daysLoading ? (
                <div className="book-loading">
                  <div className="book-spinner" aria-hidden />
                  <p>Checking availability…</p>
                </div>
              ) : (
                <div className="book-day-list">
                  {days.map((d) => {
                    const parts = formatDayParts(d.date);
                    return (
                      <button
                        key={d.date}
                        type="button"
                        disabled={!d.available}
                        className={`book-day ${date === d.date ? "is-active" : ""}`}
                        onClick={() =>
                          d.available &&
                          setQuery({ date: d.date, step: "time", time: null })
                        }
                      >
                        <span className="book-day-main">
                          <span className="book-day-title">{parts.title}</span>
                          <span className="book-day-meta">{parts.meta}</span>
                        </span>
                        <span className="book-day-badge">
                          {d.available ? `${d.slotCount} times` : "Full"}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </section>
          )}

          {step === "time" && (
            <section className="book-step">
              <button
                type="button"
                className="book-back"
                onClick={() => setQuery({ step: "date" })}
              >
                ← Back
              </button>
              <h1>What time?</h1>
              <p className="book-support">
                {formatDayLabel(date)} · party of {party}
              </p>
              {slotsLoading ? (
                <div className="book-loading">
                  <div className="book-spinner" aria-hidden />
                  <p>Finding times…</p>
                </div>
              ) : softExit && slots.length === 0 ? (
                <div className="book-soft-exit">
                  <p>We&apos;re full that day.</p>
                  <p>
                    Call us
                    {venue.contactPhone ? (
                      <>
                        {" "}
                        on <a href={`tel:${venue.contactPhone}`}>{venue.contactPhone}</a>
                      </>
                    ) : null}{" "}
                    and we&apos;ll see what we can do.
                  </p>
                  <button
                    type="button"
                    className="book-cta"
                    style={{ marginTop: 16 }}
                    onClick={() => setQuery({ step: "date" })}
                  >
                    Pick another day
                  </button>
                </div>
              ) : slots.length === 0 ? (
                <p className="book-empty">No times left today — try another day.</p>
              ) : (
                <div className="book-time-grid">
                  {slots.map((s) => (
                    <button
                      key={s.time}
                      type="button"
                      className={`book-chip ${time === s.time ? "is-active" : ""}`}
                      onClick={() => {
                        setError(null);
                        setQuery({ step: "details", time: s.time });
                      }}
                    >
                      {s.time}
                    </button>
                  ))}
                </div>
              )}
            </section>
          )}

          {step === "details" && (
            <section className="book-step">
              <button
                type="button"
                className="book-back"
                onClick={() => setQuery({ step: "time" })}
              >
                ← Back
              </button>
              <h1>Your details</h1>
              <p className="book-support">
                We&apos;ll email your confirmation straight away.
              </p>
              <label className="book-field">
                <span>Name</span>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoComplete="name"
                  placeholder="Your name"
                  autoFocus
                />
              </label>
              <label className="book-field">
                <span>Email</span>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  placeholder="you@email.com"
                  required
                />
              </label>
              <label className="book-field">
                <span>Phone (optional)</span>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  autoComplete="tel"
                  placeholder="Mobile number"
                />
              </label>
              <label className="book-field">
                <span>Anything we should know?</span>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  placeholder="Allergies, high chair, celebration…"
                />
              </label>
            </section>
          )}

          {step === "confirmed" && confirmed && (
            <section className="book-step book-confirmed">
              <div className="book-logo" aria-hidden>
                ✓
              </div>
              <h1>You&apos;re booked</h1>
              <p className="book-support">
                {confirmed.partySize} on {formatDayLabel(confirmed.serviceDate)} at{" "}
                {confirmed.startTime}
              </p>
              <p className="book-ref">{confirmed.reference}</p>
              {venue.addressText ? (
                <p className="book-muted" style={{ marginBottom: 20 }}>
                  {venue.addressText}
                </p>
              ) : null}
              <p className="book-muted" style={{ marginBottom: 20 }}>
                Confirmation sent to your email.
              </p>
              {confirmed.manageUrl ? (
                <a className="book-cta" href={confirmed.manageUrl}>
                  Manage booking
                </a>
              ) : null}
              {venue.contactPhone ? (
                <p className="book-muted" style={{ marginTop: 18 }}>
                  Questions?{" "}
                  <a href={`tel:${venue.contactPhone}`}>{venue.contactPhone}</a>
                </p>
              ) : null}
            </section>
          )}
        </div>

        {step === "details" ? (
          <div className="book-footer">
            <button
              type="button"
              className="book-cta"
              disabled={submitting}
              onClick={() => void submitDetails()}
            >
              {submitting ? "Booking…" : "Book table"}
            </button>
          </div>
        ) : null}
      </main>
    </div>
  );
}
