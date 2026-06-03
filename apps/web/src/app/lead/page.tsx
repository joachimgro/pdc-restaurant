"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { IntakeFormInput } from "@lead-intake/shared-types";
import { fetchLocations, submitIntakeForm } from "@/lib/api/intake";
import "../globals.css";
import "./lead.css";

const PROGRAMMES = [
  "Kids BJJ",
  "Kids Karate",
  "Adult BJJ",
  "Adult Muay Thai",
  "MMA",
  "Not sure yet",
] as const;

const KIDS_PROGRAMMES = ["Kids BJJ", "Kids Karate", "Not sure yet"];

export default function LeadFormPage() {
  const [locations, setLocations] = useState<
    Array<{ id: string; name: string }>
  >([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{
    message: string;
    leadId: string;
  } | null>(null);

  const [form, setForm] = useState({
    name: "",
    phone: "",
    email: "",
    locationId: "manchester",
    interest: "Kids BJJ",
    childName: "",
    childAge: "",
    experience: "First-timer" as "First-timer" | "Some experience",
  });

  const showChildFields = KIDS_PROGRAMMES.includes(
    form.interest as (typeof KIDS_PROGRAMMES)[number]
  );

  useEffect(() => {
    fetchLocations()
      .then((locs) =>
        setLocations(locs.map((l) => ({ id: l.id, name: l.name })))
      )
      .catch(() =>
        setLocations([
          { id: "manchester", name: "Manchester" },
          { id: "leeds", name: "Leeds" },
          { id: "bolton", name: "Bolton" },
          { id: "stockport", name: "Stockport" },
        ])
      );
  }, []);

  const update = (key: string, value: string) => {
    setForm((f) => ({ ...f, [key]: value }));
    setError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const payload: IntakeFormInput = {
        name: form.name,
        phone: form.phone,
        locationId: form.locationId,
        interest: form.interest,
        email: form.email || undefined,
        childName: showChildFields ? form.childName : undefined,
        childAge: showChildFields && form.childAge ? form.childAge : undefined,
        experience: showChildFields ? form.experience : undefined,
      };

      const result = await submitIntakeForm(payload);
      setSuccess({
        message: result.message ?? "Thanks — we'll be in touch shortly.",
        leadId: result.leadId,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="lead-page">
        <div className="lead-card lead-success">
          <h2>You&apos;re all set</h2>
          <p>{success.message}</p>
          <p style={{ fontSize: 12, color: "var(--text-faint)" }}>
            You&apos;ll get a welcome text shortly — open the team inbox to
            watch the conversation live.
          </p>
          <Link href="/inbox">Open team inbox</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="lead-page">
      <div className="lead-card">
        <h1>Book a free trial</h1>
        <p className="subtitle">
          Share a few details and we&apos;ll text you a welcome message to get
          your free trial booked — usually within a few minutes.
        </p>

        <form className="lead-form" onSubmit={handleSubmit}>
          <div className="lead-field">
            <label htmlFor="name">Your name</label>
            <input
              id="name"
              required
              value={form.name}
              onChange={(e) => update("name", e.target.value)}
              placeholder="Sarah Khan"
            />
          </div>

          <div className="lead-row">
            <div className="lead-field">
              <label htmlFor="phone">Mobile number</label>
              <input
                id="phone"
                type="tel"
                required
                value={form.phone}
                onChange={(e) => update("phone", e.target.value)}
                placeholder="+44 7700 900 000"
              />
            </div>
            <div className="lead-field">
              <label htmlFor="email">Email (optional)</label>
              <input
                id="email"
                type="email"
                value={form.email}
                onChange={(e) => update("email", e.target.value)}
                placeholder="you@email.com"
              />
            </div>
          </div>

          <div className="lead-row">
            <div className="lead-field">
              <label htmlFor="location">Academy</label>
              <select
                id="location"
                value={form.locationId}
                onChange={(e) => update("locationId", e.target.value)}
              >
                {locations.map((loc) => (
                  <option key={loc.id} value={loc.id}>
                    {loc.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="lead-field">
              <label htmlFor="interest">Programme</label>
              <select
                id="interest"
                value={form.interest}
                onChange={(e) => update("interest", e.target.value)}
              >
                {PROGRAMMES.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {showChildFields && (
            <>
              <div className="lead-section-label">About your child</div>
              <div className="lead-row">
                <div className="lead-field">
                  <label htmlFor="childName">Child&apos;s name</label>
                  <input
                    id="childName"
                    value={form.childName}
                    onChange={(e) => update("childName", e.target.value)}
                    placeholder="Leo"
                  />
                </div>
                <div className="lead-field">
                  <label htmlFor="childAge">Age</label>
                  <input
                    id="childAge"
                    type="number"
                    min={4}
                    max={17}
                    value={form.childAge}
                    onChange={(e) => update("childAge", e.target.value)}
                    placeholder="7"
                  />
                </div>
              </div>
              <div className="lead-field">
                <label htmlFor="experience">Experience</label>
                <select
                  id="experience"
                  value={form.experience}
                  onChange={(e) =>
                    update(
                      "experience",
                      e.target.value as typeof form.experience
                    )
                  }
                >
                  <option value="First-timer">First-timer</option>
                  <option value="Some experience">Some experience</option>
                </select>
              </div>
            </>
          )}

          {error && <div className="lead-error">{error}</div>}

          <button type="submit" className="lead-submit" disabled={loading}>
            {loading ? "Submitting…" : "Request free trial"}
          </button>
        </form>

        <p className="lead-footer-link">
          Team member? <Link href="/inbox">Open inbox</Link>
        </p>
      </div>
    </div>
  );
}
