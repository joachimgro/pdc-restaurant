"use client";

import { useCallback, useEffect, useState } from "react";
import type { StaffUser } from "@lead-intake/shared-types";
import { useInboxStore } from "@/store/inbox-store";
import {
  createLocation,
  fetchAdminLocations,
  saveProgrammeSchedule,
  updateLocation,
  type AdminLocation,
  type ScheduleSlotInput,
} from "@/lib/api/locations";
import { TeamSection } from "./TeamSection";
import { SettingsSectionRow } from "./SettingsSectionRow";
import { WorkspacePlaceholder } from "./WorkspacePlaceholder";

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

type SettingsArea = "locations" | "team" | "demo";

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

const AREA_LABELS: Record<SettingsArea, string> = {
  locations: "Locations",
  team: "Team",
  demo: "Demo tools",
};

const AREA_META: Record<SettingsArea, string> = {
  locations: "Venues & class schedules",
  team: "Staff access & invites",
  demo: "Sample data for sales",
};

const AREA_ABBREV: Record<SettingsArea, string> = {
  locations: "L",
  team: "T",
  demo: "D",
};

export function SettingsWorkspace({
  staffUser,
  initialArea = "locations",
}: {
  staffUser: StaffUser | null;
  initialArea?: SettingsArea;
}) {
  const restoreDemo = useInboxStore((s) => s.restoreDemoSeed);
  const [area, setArea] = useState<SettingsArea>(initialArea);
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
  const [demoBusy, setDemoBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newLoc, setNewLoc] = useState({ id: "", name: "", abbrev: "" });

  const canManageTeam = staffUser?.canManageTeam ?? false;
  const areas: SettingsArea[] = canManageTeam
    ? ["locations", "team", "demo"]
    : ["locations", "demo"];

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const locs = await fetchAdminLocations();
      setLocations(locs);
      setSelectedId((prev) => prev ?? locs[0]?.id ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (area === "team" && !canManageTeam) {
      setArea("locations");
    }
  }, [area, canManageTeam]);

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
      setArea("locations");
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

  const handleRestoreDemo = async () => {
    setDemoBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await restoreDemo();
      setMessage(
        result.seeded
          ? `Restored ${result.count} demo leads.`
          : `Demo data already present (${result.count} leads).`
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Restore failed");
    } finally {
      setDemoBusy(false);
    }
  };

  function selectArea(next: SettingsArea) {
    setArea(next);
    setMessage(null);
    setError(null);
    setSelectedId(null);
  }

  function selectLocation(id: string) {
    setArea("locations");
    setSelectedId(id);
    setMessage(null);
    setError(null);
  }

  return (
    <>
      <aside className="leads workspace-panel">
        <div className="leads-header">
          <div>
            <div className="leads-title">Settings</div>
            <div className="leads-count">
              {areas.length} section{areas.length === 1 ? "" : "s"}
            </div>
          </div>
        </div>

        <div className="leads-scroll">
          <div className="leads-group-label">Configuration</div>
          {areas.map((key) => (
            <SettingsSectionRow
              key={key}
              title={AREA_LABELS[key]}
              meta={AREA_META[key]}
              abbrev={AREA_ABBREV[key]}
              active={area === key && (key !== "locations" || !selectedId)}
              onSelect={() => selectArea(key)}
            />
          ))}

          {area === "locations" && (
            <>
              <div className="leads-group-label">Your locations</div>
              {loading && !locations.length ? (
                <div className="leads-empty-filter">Loading…</div>
              ) : !locations.length ? (
                <div className="leads-empty-filter">No locations yet</div>
              ) : (
                locations.map((loc) => (
                  <SettingsSectionRow
                    key={loc.id}
                    title={loc.name}
                    meta={`${loc.abbrev} · ${Object.keys(loc.programmes).length} programme(s)`}
                    abbrev={loc.abbrev}
                    nested
                    active={selectedId === loc.id}
                    onSelect={() => selectLocation(loc.id)}
                  />
                ))
              )}
            </>
          )}
        </div>
      </aside>

      <section className="conversation workspace-main">
        {area === "locations" && !selected && (
          <div className="workspace-main-scroll">
            <div className="workspace-main-header">
              <h2>Locations</h2>
              <p className="workspace-main-sub">
                Add a venue and configure class schedules. Times sync to AI
                knowledge automatically.
              </p>
            </div>
            <div className="workspace-section">
              <h3>Add location</h3>
              <div className="workspace-row">
                <input
                  value={newLoc.id}
                  onChange={(e) =>
                    setNewLoc((n) => ({ ...n, id: e.target.value }))
                  }
                  placeholder="slug (e.g. wigan)"
                  className="workspace-input"
                />
                <input
                  value={newLoc.name}
                  onChange={(e) =>
                    setNewLoc((n) => ({ ...n, name: e.target.value }))
                  }
                  placeholder="Display name"
                  className="workspace-input"
                />
                <input
                  value={newLoc.abbrev}
                  onChange={(e) =>
                    setNewLoc((n) => ({ ...n, abbrev: e.target.value }))
                  }
                  placeholder="Abbr"
                  className="workspace-input workspace-input--short"
                  maxLength={3}
                />
                <button
                  type="button"
                  className="workspace-btn"
                  onClick={() => void handleCreateLocation()}
                >
                  Add
                </button>
              </div>
            </div>
            {message && <p className="workspace-msg ok">{message}</p>}
            {error && <p className="workspace-msg error">{error}</p>}
          </div>
        )}

        {area === "locations" && selected && (
          <div className="workspace-main-scroll">
            <div className="workspace-main-header">
              <h2>{selected.name}</h2>
              <p className="workspace-main-sub">
                Class times sync to AI — the assistant only books trials after
                the lead confirms.
              </p>
            </div>

            <div className="workspace-section">
              <h3>Display name</h3>
              <div className="workspace-row">
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
                  className="workspace-input"
                />
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
                  className="workspace-input workspace-input--short"
                  maxLength={3}
                />
                <button
                  type="button"
                  className="workspace-btn workspace-btn--secondary"
                  onClick={() => void handleRenameLocation()}
                >
                  Save name
                </button>
              </div>
            </div>

            <div className="workspace-section">
              <h3>Programme schedule</h3>
              <label className="workspace-label">Programme</label>
              <select
                value={programme}
                onChange={(e) => setProgramme(e.target.value)}
                className="workspace-input workspace-select"
              >
                {PROGRAMMES.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>

              {slots.map((slot, idx) => (
                <div key={idx} className="workspace-slot-block">
                  <div className="workspace-row">
                    <div>
                      <label className="workspace-label">Time (24h)</label>
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
                        className="workspace-input"
                      />
                    </div>
                    <div>
                      <label className="workspace-label">SMS label</label>
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
                        className="workspace-input"
                      />
                    </div>
                    {slots.length > 1 && (
                      <button
                        type="button"
                        className="workspace-btn workspace-btn--secondary"
                        onClick={() =>
                          setSlots((prev) => prev.filter((_, i) => i !== idx))
                        }
                      >
                        Remove
                      </button>
                    )}
                  </div>
                  <div className="workspace-day-grid">
                    {DAYS.map((d) => (
                      <label
                        key={d.id}
                        className={`workspace-day-chip ${slot.days.includes(d.id) ? "selected" : ""}`}
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

              <div className="workspace-row" style={{ marginTop: 16 }}>
                <button
                  type="button"
                  className="workspace-btn workspace-btn--secondary"
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
                  className="workspace-btn"
                  disabled={saving}
                  onClick={() => void handleSaveSchedule()}
                >
                  {saving ? "Saving…" : "Save & sync to AI"}
                </button>
              </div>
            </div>

            {message && <p className="workspace-msg ok">{message}</p>}
            {error && <p className="workspace-msg error">{error}</p>}
          </div>
        )}

        {area === "team" && staffUser && (
          <div className="workspace-main-scroll">
            <div className="workspace-main-header">
              <h2>Team</h2>
              <p className="workspace-main-sub">
                Manage who can access this inbox. Members complete a short
                profile on first sign-in.
              </p>
            </div>
            <TeamSection staffUser={staffUser} />
          </div>
        )}

        {area === "demo" && (
          <div className="workspace-main-scroll">
            <div className="workspace-main-header">
              <h2>Demo tools</h2>
              <p className="workspace-main-sub">
                Restore sample leads for demos when the inbox is empty. Requires
                demo seed data in the client repo and{" "}
                <code>ENABLE_DEMO_TOOLS=true</code> on the Worker.
              </p>
            </div>
            <button
              type="button"
              className="workspace-btn"
              disabled={demoBusy}
              onClick={() => void handleRestoreDemo()}
            >
              {demoBusy ? "Restoring…" : "Restore demo leads"}
            </button>
            {message && <p className="workspace-msg ok">{message}</p>}
            {error && <p className="workspace-msg error">{error}</p>}
          </div>
        )}
      </section>
    </>
  );
}
