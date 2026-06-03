"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  createLocation,
  fetchAdminLocations,
  saveProgrammeSchedule,
  updateLocation,
  type AdminLocation,
  type ScheduleSlotInput,
} from "@/lib/api/locations";
import "../globals.css";
import "./settings.css";

const PROGRAMMES = [
  "Kids BJJ",
  "Kids Karate",
  "Adult BJJ",
  "Adult Muay Thai",
  "MMA",
  "Not sure yet",
] as const;

const DAYS = [
  { id: "mon", label: "Mon" },
  { id: "tue", label: "Tue" },
  { id: "wed", label: "Wed" },
  { id: "thu", label: "Thu" },
  { id: "fri", label: "Fri" },
  { id: "sat", label: "Sat" },
  { id: "sun", label: "Sun" },
] as const;

type SlotDraft = {
  days: string[];
  startTime: string;
  displayLabel: string;
};

function timeToLabel(time: string): string {
  const [h, m] = time.split(":").map(Number);
  if (Number.isNaN(h)) return time;
  const suffix = h >= 12 ? "pm" : "am";
  const hour12 = h % 12 || 12;
  return m ? `${hour12}:${String(m).padStart(2, "0")}${suffix}` : `${hour12}${suffix}`;
}

export default function SettingsPage() {
  const [locations, setLocations] = useState<AdminLocation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [programme, setProgramme] = useState<string>("MMA");
  const [slots, setSlots] = useState<SlotDraft[]>([
    { days: ["tue", "thu"], startTime: "17:00", displayLabel: "5pm" },
    { days: ["tue", "thu"], startTime: "19:30", displayLabel: "7:30pm" },
    { days: ["tue", "thu"], startTime: "20:30", displayLabel: "8:30pm" },
  ]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [newLoc, setNewLoc] = useState({ id: "", name: "", abbrev: "" });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const locs = await fetchAdminLocations();
      setLocations(locs);
      if (!selectedId && locs[0]) setSelectedId(locs[0].id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [selectedId]);

  useEffect(() => {
    void load();
  }, [load]);

  const selected = locations.find((l) => l.id === selectedId);

  useEffect(() => {
    if (!selected || !programme) return;
    const existing = selected.programmes[programme];
    if (!existing?.length) return;

    const byTime = new Map<string, SlotDraft>();
    for (const row of existing) {
      let draft = byTime.get(row.startTime);
      if (!draft) {
        draft = {
          days: [],
          startTime: row.startTime,
          displayLabel: row.displayLabel,
        };
        byTime.set(row.startTime, draft);
      }
      if (!draft.days.includes(row.dayOfWeek)) {
        draft.days.push(row.dayOfWeek);
      }
    }
    setSlots([...byTime.values()]);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- reload slots when switching programme/location
  }, [selectedId, programme]);

  const toggleDay = (slotIndex: number, day: string) => {
    setSlots((prev) =>
      prev.map((s, i) => {
        if (i !== slotIndex) return s;
        const days = s.days.includes(day)
          ? s.days.filter((d) => d !== day)
          : [...s.days, day];
        return { ...s, days };
      })
    );
  };

  const handleSaveSchedule = async () => {
    if (!selectedId) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const payload: ScheduleSlotInput[] = [];
      let order = 0;
      for (const slot of slots) {
        for (const day of slot.days) {
          payload.push({
            dayOfWeek: day,
            startTime: slot.startTime,
            displayLabel: slot.displayLabel || timeToLabel(slot.startTime),
            sortOrder: order++,
          });
        }
      }
      const result = await saveProgrammeSchedule(
        selectedId,
        programme,
        payload
      );
      setMessage(result.message ?? "Schedule saved and synced to AI.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const handleCreateLocation = async () => {
    setError(null);
    try {
      await createLocation({
        id: newLoc.id.toLowerCase().trim(),
        name: newLoc.name.trim(),
        abbrev: newLoc.abbrev.trim(),
      });
      setNewLoc({ id: "", name: "", abbrev: "" });
      await load();
      setMessage("Location created.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Create failed");
    }
  };

  const handleRenameLocation = async () => {
    const loc = locations.find((l) => l.id === selectedId);
    if (!loc) return;
    try {
      await updateLocation(loc.id, {
        name: loc.name,
        abbrev: loc.abbrev,
      });
      setMessage("Location updated.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed");
    }
  };

  if (loading && !locations.length) {
    return (
      <div className="settings-page">
        <p>Loading settings…</p>
      </div>
    );
  }

  return (
    <div className="settings-page">
      <div className="settings-header">
        <h1>Locations &amp; schedules</h1>
        <Link href="/inbox" className="settings-back">
          ← Back to inbox
        </Link>
      </div>

      <p style={{ fontSize: 14, color: "var(--text-muted)", marginBottom: 20 }}>
        Class times sync to AI knowledge automatically. The assistant will
        answer which days classes run and only books a trial after the lead
        confirms.
      </p>

      <div className="settings-card">
        <h2>Add location</h2>
        <div className="settings-row">
          <div className="settings-field">
            <label>Id (slug)</label>
            <input
              value={newLoc.id}
              onChange={(e) => setNewLoc((n) => ({ ...n, id: e.target.value }))}
              placeholder="e.g. wigan"
            />
          </div>
          <div className="settings-field">
            <label>Name</label>
            <input
              value={newLoc.name}
              onChange={(e) =>
                setNewLoc((n) => ({ ...n, name: e.target.value }))
              }
              placeholder="Wigan"
            />
          </div>
          <div className="settings-field" style={{ maxWidth: 80 }}>
            <label>Abbrev</label>
            <input
              value={newLoc.abbrev}
              onChange={(e) =>
                setNewLoc((n) => ({ ...n, abbrev: e.target.value }))
              }
              placeholder="W"
              maxLength={3}
            />
          </div>
          <button
            type="button"
            className="settings-btn"
            onClick={() => void handleCreateLocation()}
          >
            Add
          </button>
        </div>
      </div>

      <div className="settings-card">
        <h2>Locations</h2>
        <div className="loc-list">
          {locations.map((loc) => (
            <button
              key={loc.id}
              type="button"
              className={`loc-item ${selectedId === loc.id ? "active" : ""}`}
              onClick={() => setSelectedId(loc.id)}
            >
              <span>
                <strong>{loc.name}</strong>{" "}
                <span style={{ color: "var(--text-muted)" }}>({loc.id})</span>
              </span>
              <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                {Object.keys(loc.programmes).length} programme(s)
              </span>
            </button>
          ))}
        </div>
      </div>

      {selected && (
        <>
          <div className="settings-card">
            <h2>{selected.name}</h2>
            <div className="settings-row">
              <div className="settings-field">
                <label>Display name</label>
                <input
                  value={selected.name}
                  onChange={(e) =>
                    setLocations((prev) =>
                      prev.map((l) =>
                        l.id === selected.id
                          ? { ...l, name: e.target.value }
                          : l
                      )
                    )
                  }
                />
              </div>
              <div className="settings-field" style={{ maxWidth: 80 }}>
                <label>Abbrev</label>
                <input
                  value={selected.abbrev}
                  onChange={(e) =>
                    setLocations((prev) =>
                      prev.map((l) =>
                        l.id === selected.id
                          ? { ...l, abbrev: e.target.value.toUpperCase() }
                          : l
                      )
                    )
                  }
                />
              </div>
              <button
                type="button"
                className="settings-btn secondary"
                onClick={() => void handleRenameLocation()}
              >
                Save name
              </button>
            </div>
          </div>

          <div className="settings-card">
            <h2>Programme schedule</h2>
            <div className="settings-field" style={{ maxWidth: 280 }}>
              <label>Programme</label>
              <select
                value={programme}
                onChange={(e) => setProgramme(e.target.value)}
              >
                {PROGRAMMES.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>

            {slots.map((slot, idx) => (
              <div
                key={idx}
                style={{
                  marginTop: 16,
                  paddingTop: 12,
                  borderTop: "1px solid var(--border)",
                }}
              >
                <div className="slot-row">
                  <div className="settings-field" style={{ maxWidth: 100 }}>
                    <label>Time (24h)</label>
                    <input
                      type="time"
                      value={slot.startTime}
                      onChange={(e) => {
                        const startTime = e.target.value;
                        setSlots((prev) =>
                          prev.map((s, i) =>
                            i === idx
                              ? {
                                  ...s,
                                  startTime,
                                  displayLabel: timeToLabel(startTime),
                                }
                              : s
                          )
                        );
                      }}
                    />
                  </div>
                  <div className="settings-field" style={{ maxWidth: 120 }}>
                    <label>SMS label</label>
                    <input
                      value={slot.displayLabel}
                      onChange={(e) =>
                        setSlots((prev) =>
                          prev.map((s, i) =>
                            i === idx
                              ? { ...s, displayLabel: e.target.value }
                              : s
                          )
                        )
                      }
                    />
                  </div>
                  {slots.length > 1 && (
                    <button
                      type="button"
                      className="settings-btn secondary"
                      onClick={() =>
                        setSlots((prev) => prev.filter((_, i) => i !== idx))
                      }
                    >
                      Remove
                    </button>
                  )}
                </div>
                <div className="day-grid">
                  {DAYS.map((d) => (
                    <label
                      key={d.id}
                      className={`day-chip ${slot.days.includes(d.id) ? "selected" : ""}`}
                    >
                      <input
                        type="checkbox"
                        checked={slot.days.includes(d.id)}
                        onChange={() => toggleDay(idx, d.id)}
                        style={{ display: "none" }}
                      />
                      {d.label}
                    </label>
                  ))}
                </div>
              </div>
            ))}

            <div className="settings-row" style={{ marginTop: 16 }}>
              <button
                type="button"
                className="settings-btn secondary"
                onClick={() =>
                  setSlots((prev) => [
                    ...prev,
                    { days: [], startTime: "19:00", displayLabel: "7pm" },
                  ])
                }
              >
                + Add time slot
              </button>
              <button
                type="button"
                className="settings-btn"
                disabled={saving}
                onClick={() => void handleSaveSchedule()}
              >
                {saving ? "Saving…" : "Save & sync to AI"}
              </button>
            </div>
          </div>
        </>
      )}

      {message && <p className="settings-msg ok">{message}</p>}
      {error && <p className="settings-msg error">{error}</p>}
    </div>
  );
}
