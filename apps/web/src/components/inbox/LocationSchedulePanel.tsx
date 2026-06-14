"use client";

import { useEffect, useMemo, useState } from "react";
import {
  saveProgrammeSchedule,
  updateLocation,
  type AdminLocation,
  type ScheduleSlotInput,
} from "@/lib/api/locations";
import {
  emptyWeekSchedule,
  scheduleRowsToWeek,
  weekToScheduleSlots,
  type WeekSchedule,
} from "@/lib/schedule-calendar";
import { ScheduleWeekCalendar } from "./ScheduleWeekCalendar";

const DEFAULT_PROGRAMME = "General";

type Props = {
  location: AdminLocation;
  serviceLabel: string;
  onSaved: () => Promise<void>;
  onMessage: (msg: string | null) => void;
  onError: (err: string | null) => void;
};

export function LocationSchedulePanel({
  location,
  serviceLabel,
  onSaved,
  onMessage,
  onError,
}: Props) {
  const programmeNames = useMemo(() => {
    const keys = Object.keys(location.programmes);
    return keys.length ? keys : [DEFAULT_PROGRAMME];
  }, [location.programmes]);

  const [name, setName] = useState(location.name);
  const [abbrev, setAbbrev] = useState(location.abbrev);
  const [programme, setProgramme] = useState(programmeNames[0] ?? DEFAULT_PROGRAMME);
  const [addingProgramme, setAddingProgramme] = useState(false);
  const [newProgramme, setNewProgramme] = useState("");
  const [week, setWeek] = useState<WeekSchedule>(emptyWeekSchedule());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setProgramme(programmeNames[0] ?? DEFAULT_PROGRAMME);
    setAddingProgramme(false);
    setNewProgramme("");
  }, [location.id, programmeNames]);

  useEffect(() => {
    setName(location.name);
    setAbbrev(location.abbrev);
  }, [location.id, location.name, location.abbrev]);

  useEffect(() => {
    const rows = location.programmes[programme] ?? [];
    setWeek(scheduleRowsToWeek(rows));
  }, [location.id, location.programmes, programme]);

  const activeProgramme = addingProgramme ? newProgramme.trim() : programme;

  const handleSaveName = async () => {
    onError(null);
    onMessage(null);
    try {
      await updateLocation(location.id, { name, abbrev });
      onMessage("Location updated.");
      await onSaved();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Update failed");
    }
  };

  const handleSaveSchedule = async () => {
    const prog = activeProgramme;
    if (!prog) {
      onError(`Enter a ${serviceLabel} name first.`);
      return;
    }
    setSaving(true);
    onError(null);
    onMessage(null);
    try {
      const payload: ScheduleSlotInput[] = weekToScheduleSlots(week);
      const result = await saveProgrammeSchedule(location.id, prog, payload);
      onMessage(result.message ?? "Schedule saved and synced to AI knowledge.");
      setProgramme(prog);
      setAddingProgramme(false);
      setNewProgramme("");
      await onSaved();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="workspace-section">
        <h3>Location details</h3>
        <p className="workspace-hint">
          Most businesses only need one location. Add more from the sidebar if you
          run multiple venues.
        </p>
        <div className="workspace-form-grid">
          <label className="workspace-field">
            <span className="workspace-label">Display name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="workspace-input"
              placeholder="Default location"
            />
          </label>
          <label className="workspace-field workspace-field--short">
            <span className="workspace-label">Short code</span>
            <input
              value={abbrev}
              onChange={(e) => setAbbrev(e.target.value.toUpperCase())}
              className="workspace-input"
              maxLength={3}
            />
          </label>
        </div>
        <button
          type="button"
          className="workspace-btn workspace-btn--secondary"
          onClick={() => void handleSaveName()}
        >
          Save name
        </button>
      </div>

      <div className="workspace-section">
        <h3>Weekly schedule</h3>
        <p className="workspace-hint">
          Tap a day to add {serviceLabel}s. Times sync to AI knowledge when you
          save — the assistant uses these for booking.
        </p>

        <div className="workspace-form-grid">
          <label className="workspace-field">
            <span className="workspace-label">{serviceLabel} name</span>
            <select
              value={addingProgramme ? "__new__" : programme}
              onChange={(e) => {
                if (e.target.value === "__new__") {
                  setAddingProgramme(true);
                } else {
                  setAddingProgramme(false);
                  setProgramme(e.target.value);
                  setNewProgramme("");
                }
              }}
              className="workspace-input workspace-select"
            >
              {programmeNames.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
              <option value="__new__">+ Add new…</option>
            </select>
          </label>
          {addingProgramme && (
            <label className="workspace-field">
              <span className="workspace-label">New {serviceLabel}</span>
              <input
                value={newProgramme}
                onChange={(e) => setNewProgramme(e.target.value)}
                className="workspace-input"
                placeholder="e.g. Piano lessons, GCSE Maths, Adult BJJ"
              />
            </label>
          )}
        </div>

        <ScheduleWeekCalendar
          schedule={week}
          onChange={setWeek}
          serviceLabel={serviceLabel}
        />

        <div className="workspace-actions">
          <button
            type="button"
            className="workspace-btn"
            disabled={saving}
            onClick={() => void handleSaveSchedule()}
          >
            {saving ? "Saving…" : "Save schedule & sync to AI"}
          </button>
        </div>
      </div>
    </>
  );
}
