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
import "./book.css";

type Step = "party" | "date" | "time" | "details" | "confirmed";

const STEPS: Step[] = ["party", "date", "time", "details", "confirmed"];

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

export default function BookClient() {
  const params = useParams<{ slug: string }>();
  const slug = params.slug;
  const search = useSearchParams();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const step = (search.get("step") as Step) || "party";
  const party = Number(search.get("party") || "2");
  const date = search.get("date") || "";
  const time = search.get("time") || "";

  const [venue, setVenue] = useState<BookVenue | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [softExit, setSoftExit] = useState<string | null>(null);
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
    (async () => {
      try {
        const res = await getBookDays(slug, { party, from, to });
        if (!cancelled) setDays(res.days);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not load days");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [venue, step, slug, party]);

  useEffect(() => {
    if (!venue || step !== "time" || !date) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await getBookAvailability(slug, { date, party });
        if (cancelled) return;
        setSlots(res.slots);
        setSoftExit(res.softExit);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not load times");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [venue, step, slug, date, party]);

  const progress = useMemo(() => {
    const i = STEPS.indexOf(step);
    return Math.max(0, (i / (STEPS.length - 1)) * 100);
  }, [step]);

  async function goToDetails(selectedTime: string) {
    setError(null);
    setQuery({ step: "details", time: selectedTime });
  }

  async function submitDetails() {
    setError(null);
    if (!name.trim()) {
      setError("What's your name?");
      return;
    }
    if (!email.trim() && !phone.trim()) {
      setError("Leave an email or a phone number so we can reach you");
      return;
    }
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
    }
  }

  if (error && !venue) {
    return (
      <main className="book-shell">
        <p className="book-error">{error}</p>
      </main>
    );
  }

  if (!venue) {
    return (
      <main className="book-shell">
        <p className="book-muted">Loading…</p>
      </main>
    );
  }

  return (
    <main className="book-shell">
      <header className="book-header">
        <p className="book-brand">{venue.name}</p>
        <div className="book-progress" aria-hidden>
          <div className="book-progress-bar" style={{ width: `${progress}%` }} />
        </div>
      </header>

      {error ? <p className="book-error" role="alert">{error}</p> : null}

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
          <button type="button" className="book-back" onClick={() => setQuery({ step: "party" })}>
            Back
          </button>
          <h1>Which day?</h1>
          <p className="book-support">Party of {party}</p>
          <div className="book-day-list">
            {days.map((d) => (
              <button
                key={d.date}
                type="button"
                disabled={!d.available}
                className={`book-day ${date === d.date ? "is-active" : ""}`}
                onClick={() =>
                  d.available && setQuery({ date: d.date, step: "time", time: null })
                }
              >
                <span>{formatDayLabel(d.date)}</span>
                <span className="book-muted">
                  {d.available ? `${d.slotCount} times` : "Full"}
                </span>
              </button>
            ))}
          </div>
        </section>
      )}

      {step === "time" && (
        <section className="book-step">
          <button type="button" className="book-back" onClick={() => setQuery({ step: "date" })}>
            Back
          </button>
          <h1>What time?</h1>
          <p className="book-support">
            {formatDayLabel(date)} · party of {party}
          </p>
          {softExit && slots.length === 0 ? (
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
              <button type="button" className="book-cta" onClick={() => setQuery({ step: "date" })}>
                Pick another day
              </button>
            </div>
          ) : (
            <div className="book-time-grid">
              {slots.map((s) => (
                <button
                  key={s.time}
                  type="button"
                  className={`book-chip ${time === s.time ? "is-active" : ""}`}
                  onClick={() => goToDetails(s.time)}
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
          <button type="button" className="book-back" onClick={() => setQuery({ step: "time" })}>
            Back
          </button>
          <h1>Your details</h1>
          <p className="book-support">
            {formatDayLabel(date)} at {time} · party of {party}
          </p>
          <label className="book-field">
            <span>Name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
          </label>
          <label className="book-field">
            <span>Email</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
            />
          </label>
          <label className="book-field">
            <span>Phone</span>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              autoComplete="tel"
            />
          </label>
          <label className="book-field">
            <span>Anything we should know?</span>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
          </label>
          <button
            type="button"
            className="book-cta"
            disabled={pending}
            onClick={() => void submitDetails()}
          >
            Book table
          </button>
        </section>
      )}

      {step === "confirmed" && confirmed && (
        <section className="book-step book-confirmed">
          <h1>You&apos;re booked</h1>
          <p className="book-support">
            {confirmed.partySize} on {formatDayLabel(confirmed.serviceDate)} at{" "}
            {confirmed.startTime}
          </p>
          <p className="book-ref">Reference {confirmed.reference}</p>
          {venue.addressText ? <p className="book-muted">{venue.addressText}</p> : null}
          {confirmed.manageUrl ? (
            <a className="book-cta" href={confirmed.manageUrl}>
              Manage booking
            </a>
          ) : null}
          {venue.contactPhone ? (
            <p className="book-muted">
              Questions? <a href={`tel:${venue.contactPhone}`}>{venue.contactPhone}</a>
            </p>
          ) : null}
        </section>
      )}
    </main>
  );
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
