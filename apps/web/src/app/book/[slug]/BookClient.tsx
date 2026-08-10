"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import {
  getBookAvailability,
  getBookDays,
  getBookVenue,
  postBookHold,
  postBookReserve,
  postBookWaitlist,
  type BookVenue,
} from "@/lib/api/book";
import { TurnstileField } from "../TurnstileField";
import "../book.css";

const TURNSTILE_SITE_KEY =
  process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim() || "";

type Step = "party" | "date" | "time" | "details" | "confirmed";

const STEPS: Step[] = ["party", "date", "time", "details", "confirmed"];

const OCCASIONS = [
  "",
  "Birthday",
  "Anniversary",
  "Date night",
  "Business",
  "Celebration",
  "Other",
] as const;

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

function brandAccent(brand: Record<string, unknown> | null | undefined): string {
  const raw = brand?.accent;
  return typeof raw === "string" && /^#[0-9a-fA-F]{3,8}$/.test(raw)
    ? raw
    : "#FF6B6B";
}

function brandName(venue: BookVenue): string {
  const display = venue.brand?.displayName;
  return typeof display === "string" && display.trim()
    ? display.trim()
    : venue.name;
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
  const [allergies, setAllergies] = useState("");
  const [occasion, setOccasion] = useState("");
  const [notes, setNotes] = useState("");
  const [marketingOptIn, setMarketingOptIn] = useState(false);
  const [waitlistName, setWaitlistName] = useState("");
  const [waitlistEmail, setWaitlistEmail] = useState("");
  const [waitlistPhone, setWaitlistPhone] = useState("");
  const [waitlistDone, setWaitlistDone] = useState(false);
  const [waitlistPending, setWaitlistPending] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const onTurnstileToken = useCallback((token: string | null) => {
    setTurnstileToken(token);
  }, []);

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
    let cancelled = false;
    const from = todayISO(venue.timezone);
    const to = addDaysISO(from, Math.min(venue.maxAdvanceDays ?? 90, 21));
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
  }, [venue, step, party, slug]);

  useEffect(() => {
    if (!venue || step !== "time" || !date) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await getBookAvailability(slug, { date, party });
        if (cancelled) return;
        setSlots(res.slots.map((s) => ({ time: s.time })));
        setSoftExit(res.softExit);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not load times");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [venue, step, date, party, slug]);

  const progress = useMemo(() => {
    const idx = Math.max(0, STEPS.indexOf(step));
    return ((idx + 1) / STEPS.length) * 100;
  }, [step]);

  const smsOn = Boolean(venue?.bookingSmsEnabled);

  function goToDetails(t: string) {
    setQuery({ time: t, step: "details" });
  }

  async function submitWaitlist() {
    setError(null);
    if (!waitlistName.trim()) {
      setError("What's your name?");
      return;
    }
    if (!waitlistEmail.trim() && !waitlistPhone.trim()) {
      setError("Leave an email or phone so we can reach you");
      return;
    }
    if (TURNSTILE_SITE_KEY && !turnstileToken) {
      setError("Complete the security check below");
      return;
    }
    setWaitlistPending(true);
    try {
      await postBookWaitlist(slug, {
        guestName: waitlistName.trim(),
        partySize: party,
        serviceDate: date,
        guestEmail: waitlistEmail.trim() || undefined,
        guestPhone: waitlistPhone.trim() || undefined,
        kind: "date_waitlist",
        turnstileToken: turnstileToken || undefined,
      });
      setWaitlistDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not join waitlist");
    } finally {
      setWaitlistPending(false);
    }
  }

  async function submitDetails() {
    setError(null);
    if (!name.trim()) {
      setError("What's your name?");
      return;
    }
    if (!email.trim()) {
      setError("We need an email for your confirmation");
      return;
    }
    if (smsOn && !phone.trim()) {
      setError("Add a mobile number for text reminders");
      return;
    }
    if (!smsOn && !phone.trim() && !email.trim()) {
      setError("Leave an email or a phone number so we can reach you");
      return;
    }
    if (TURNSTILE_SITE_KEY && !turnstileToken) {
      setError("Complete the security check below");
      return;
    }
    try {
      const hold = await postBookHold(slug, {
        partySize: party,
        serviceDate: date,
        startTime: time,
        turnstileToken: turnstileToken || undefined,
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
          allergies: allergies.trim() || undefined,
          occasion: occasion.trim() || undefined,
          marketingOptIn,
          turnstileToken: turnstileToken || undefined,
        },
        idem
      );
      if (reserved.checkoutUrl) {
        window.location.assign(reserved.checkoutUrl);
        return;
      }
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

  const accent = brandAccent(venue.brand);
  const title = brandName(venue);

  return (
    <main className="book-shell" style={{ ["--book-accent" as string]: accent }}>
      <header className="book-header">
        <p className="book-brand">{title}</p>
        <p className="book-tagline">Book a table</p>
        <div className="book-progress" aria-hidden>
          <div className="book-progress-bar" style={{ width: `${progress}%` }} />
        </div>
      </header>

      {step !== "party" && step !== "confirmed" ? (
        <div className="book-summary" aria-label="Your selection">
          <span className="book-pill">Party of {party}</span>
          {date ? <span className="book-pill">{formatDayLabel(date)}</span> : null}
          {time ? <span className="book-pill">{time}</span> : null}
        </div>
      ) : null}

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
              {waitlistDone ? (
                <>
                  <p>You&apos;re on the waitlist.</p>
                  <p className="book-muted">
                    This isn&apos;t a confirmed booking — we&apos;ll contact you if a table opens up.
                  </p>
                  <button
                    type="button"
                    className="book-cta"
                    onClick={() => setQuery({ step: "date" })}
                  >
                    Pick another day
                  </button>
                </>
              ) : venue.waitlistEnabled ? (
                <>
                  <p>We&apos;re full that day — join the waitlist and we&apos;ll be in touch.</p>
                  <label className="book-field">
                    <span>Name</span>
                    <input
                      value={waitlistName}
                      onChange={(e) => setWaitlistName(e.target.value)}
                      autoComplete="name"
                    />
                  </label>
                  <label className="book-field">
                    <span>Email</span>
                    <input
                      type="email"
                      value={waitlistEmail}
                      onChange={(e) => setWaitlistEmail(e.target.value)}
                      autoComplete="email"
                    />
                  </label>
                  <label className="book-field">
                    <span>Mobile</span>
                    <input
                      type="tel"
                      value={waitlistPhone}
                      onChange={(e) => setWaitlistPhone(e.target.value)}
                      autoComplete="tel"
                      inputMode="tel"
                    />
                  </label>
                  {TURNSTILE_SITE_KEY ? (
                    <TurnstileField
                      siteKey={TURNSTILE_SITE_KEY}
                      onToken={onTurnstileToken}
                    />
                  ) : null}
                  <button
                    type="button"
                    className="book-cta"
                    disabled={waitlistPending}
                    onClick={() => void submitWaitlist()}
                  >
                    Join waitlist
                  </button>
                  {venue.contactPhone ? (
                    <p className="book-muted">
                      Or call us on{" "}
                      <a href={`tel:${venue.contactPhone}`}>{venue.contactPhone}</a>
                    </p>
                  ) : null}
                </>
              ) : (
                <>
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
                </>
              )}
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
          <div className="book-panel">
            <label className="book-field">
              <span>Name</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="name"
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
                inputMode="email"
                required
              />
            </label>
            <p className="book-hint">Confirmation and manage link go here.</p>
            <label className="book-field">
              <span>{smsOn ? "Mobile (required for texts)" : "Mobile"}</span>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                autoComplete="tel"
                inputMode="tel"
                placeholder="07…"
                required={smsOn}
              />
            </label>
            <p className="book-hint">
              {smsOn
                ? "We'll text a confirmation and a reminder before your booking. Reply STOP anytime."
                : "Optional — handy if we need to reach you on the day."}
            </p>
            <label className="book-field">
              <span>Allergies / dietary</span>
              <input
                value={allergies}
                onChange={(e) => setAllergies(e.target.value)}
                placeholder="Nuts, gluten, …"
              />
            </label>
            <label className="book-field">
              <span>Occasion</span>
              <select value={occasion} onChange={(e) => setOccasion(e.target.value)}>
                {OCCASIONS.map((o) => (
                  <option key={o || "none"} value={o}>
                    {o || "No special occasion"}
                  </option>
                ))}
              </select>
            </label>
            <label className="book-field">
              <span>Anything else we should know?</span>
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
            </label>
            <label className="book-check">
              <input
                type="checkbox"
                checked={marketingOptIn}
                onChange={(e) => setMarketingOptIn(e.target.checked)}
              />
              <span>Email me occasional news from {title} (optional)</span>
            </label>
            {TURNSTILE_SITE_KEY ? (
              <TurnstileField
                siteKey={TURNSTILE_SITE_KEY}
                onToken={onTurnstileToken}
              />
            ) : null}
          </div>
          <button
            type="button"
            className="book-cta"
            disabled={pending}
            onClick={() => void submitDetails()}
          >
            {pending ? "Booking…" : "Confirm table"}
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
          <p className="book-muted">
            Check your email
            {smsOn && phone.trim() ? " and texts" : ""} for confirmation
            {smsOn && phone.trim() ? " and reminder" : ""}.
          </p>
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

      <footer className="book-footer">
        {venue.addressText ? <div>{venue.addressText}</div> : null}
        {venue.contactPhone ? (
          <div>
            <a href={`tel:${venue.contactPhone}`}>{venue.contactPhone}</a>
          </div>
        ) : null}
      </footer>
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
