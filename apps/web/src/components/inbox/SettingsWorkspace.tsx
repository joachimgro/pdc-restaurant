"use client";

import { useCallback, useEffect, useState } from "react";
import type { StaffUser } from "@lead-intake/shared-types";
import { useInboxStore } from "@/store/inbox-store";
import {
  createLocation,
  fetchAdminLocations,
  type AdminLocation,
} from "@/lib/api/locations";
import { fetchCapabilities } from "@/lib/api/capabilities";
import { fetchAiConfig } from "@/lib/api/ai-config";
import { AiSettingsSection } from "./AiSettingsSection";
import { LocationSchedulePanel } from "./LocationSchedulePanel";
import { TeamSection } from "./TeamSection";
import { SettingsSectionRow } from "./SettingsSectionRow";

type SettingsArea = "locations" | "team" | "demo" | "ai";

const DEFAULT_LOCATION = {
  id: "default",
  name: "Default location",
  abbrev: "DEF",
};

const AREA_LABELS: Record<SettingsArea, string> = {
  locations: "Schedule",
  team: "Team",
  ai: "AI",
  demo: "Demo tools",
};

const AREA_META: Record<SettingsArea, string> = {
  locations: "Venue & weekly timetable",
  team: "Staff access & invites",
  ai: "Persona & qualification SMS",
  demo: "Sample data for sales",
};

const AREA_ABBREV: Record<SettingsArea, string> = {
  locations: "S",
  team: "T",
  ai: "A",
  demo: "D",
};

export function SettingsWorkspace({
  staffUser,
  initialArea,
}: {
  staffUser: StaffUser | null;
  initialArea?: SettingsArea;
}) {
  const restoreDemo = useInboxStore((s) => s.restoreDemoSeed);
  const [capabilities, setCapabilities] = useState({
    simpleScheduling: false,
    multiLocation: false,
  });
  const [area, setArea] = useState<SettingsArea>(initialArea ?? "ai");
  const [locations, setLocations] = useState<AdminLocation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [serviceLabel, setServiceLabel] = useState("service");
  const [loading, setLoading] = useState(true);
  const [demoBusy, setDemoBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newLoc, setNewLoc] = useState({ id: "", name: "", abbrev: "" });

  const canManageTeam = staffUser?.canManageTeam ?? false;
  const showSchedule = capabilities.simpleScheduling;
  const areas: SettingsArea[] = canManageTeam
    ? [
        ...(showSchedule ? (["locations"] as const) : []),
        "ai",
        "team",
        "demo",
      ]
    : [
        ...(showSchedule ? (["locations"] as const) : []),
        "ai",
        "demo",
      ];

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const caps = await fetchCapabilities();
      setCapabilities(caps);
      const [locs, ai] = await Promise.all([
        caps.simpleScheduling ? fetchAdminLocations() : Promise.resolve([] as AdminLocation[]),
        fetchAiConfig().catch(() => null),
      ]);
      setLocations(locs);
      setServiceLabel(ai?.config.fieldLabels.interest ?? "service");
      setSelectedId((prev) => {
        if (prev && locs.some((l) => l.id === prev)) return prev;
        return locs[0]?.id ?? null;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!capabilities.simpleScheduling && area === "locations") {
      setArea("ai");
    }
  }, [capabilities.simpleScheduling, area]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (area === "team" && !canManageTeam) {
      setArea(showSchedule ? "locations" : "ai");
    }
  }, [area, canManageTeam, showSchedule]);

  const selected = locations.find((l) => l.id === selectedId);

  const ensureDefaultLocation = async () => {
    setError(null);
    try {
      await createLocation(DEFAULT_LOCATION);
      await load();
      setSelectedId(DEFAULT_LOCATION.id);
      setMessage("Default location created — add your weekly schedule.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Setup failed");
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
      setMessage("Location added.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Create failed");
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
    if (next !== "locations") setSelectedId(null);
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

          {showSchedule && area === "locations" && locations.length > 1 && (
            <>
              <div className="leads-group-label">Other venues</div>
              {locations.map((loc) => (
                <SettingsSectionRow
                  key={loc.id}
                  title={loc.name}
                  meta={`${loc.abbrev} · ${Object.keys(loc.programmes).length} ${serviceLabel}(s)`}
                  abbrev={loc.abbrev}
                  nested
                  active={selectedId === loc.id}
                  onSelect={() => selectLocation(loc.id)}
                />
              ))}
            </>
          )}
        </div>
      </aside>

      <section className="conversation workspace-main">
        {showSchedule && area === "locations" && loading && (
          <div className="workspace-main-scroll">
            <p className="workspace-msg">Loading…</p>
          </div>
        )}

        {showSchedule && area === "locations" && !loading && !locations.length && (
          <div className="workspace-main-scroll">
            <div className="workspace-main-header">
              <h2>Schedule</h2>
              <p className="workspace-main-sub">
                Set up when you run sessions. Most businesses only need one
                default location — add more venues later if you need them.
              </p>
            </div>
            <button
              type="button"
              className="workspace-btn"
              onClick={() => void ensureDefaultLocation()}
            >
              Set up default location
            </button>
            <div className="workspace-section" style={{ marginTop: 32 }}>
              <h3>Or add a named venue</h3>
              <div className="workspace-row">
                <input
                  value={newLoc.id}
                  onChange={(e) =>
                    setNewLoc((n) => ({ ...n, id: e.target.value }))
                  }
                  placeholder="slug (e.g. city-centre)"
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
                  className="workspace-btn workspace-btn--secondary"
                  onClick={() => void handleCreateLocation()}
                >
                  Add venue
                </button>
              </div>
            </div>
            {message && <p className="workspace-msg ok">{message}</p>}
            {error && <p className="workspace-msg error">{error}</p>}
          </div>
        )}

        {showSchedule && area === "locations" && !loading && selected && (
          <div className="workspace-main-scroll">
            <div className="workspace-main-header">
              <h2>{selected.name}</h2>
              <p className="workspace-main-sub">
                Build your week on the calendar below. Saving updates AI
                knowledge so the assistant can answer and book accurately.
              </p>
            </div>
            <LocationSchedulePanel
              location={selected}
              serviceLabel={serviceLabel}
              onSaved={load}
              onMessage={setMessage}
              onError={setError}
            />
            {locations.length === 1 && (
              <div className="workspace-section">
                <h3>Add another venue</h3>
                <div className="workspace-row">
                  <input
                    value={newLoc.id}
                    onChange={(e) =>
                      setNewLoc((n) => ({ ...n, id: e.target.value }))
                    }
                    placeholder="slug"
                    className="workspace-input"
                  />
                  <input
                    value={newLoc.name}
                    onChange={(e) =>
                      setNewLoc((n) => ({ ...n, name: e.target.value }))
                    }
                    placeholder="Name"
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
                    className="workspace-btn workspace-btn--secondary"
                    onClick={() => void handleCreateLocation()}
                  >
                    Add venue
                  </button>
                </div>
              </div>
            )}
            {message && <p className="workspace-msg ok">{message}</p>}
            {error && <p className="workspace-msg error">{error}</p>}
          </div>
        )}

        {showSchedule &&
          area === "locations" &&
          !loading &&
          locations.length > 0 &&
          !selected && (
          <div className="workspace-main-scroll">
            <div className="workspace-main-header">
              <h2>Schedule</h2>
              <p className="workspace-main-sub">
                Pick a venue from the sidebar or set up your default location.
              </p>
            </div>
            <button
              type="button"
              className="workspace-btn"
              onClick={() => setSelectedId(locations[0]?.id ?? null)}
            >
              Open {locations[0]?.name ?? "location"}
            </button>
          </div>
        )}

        {area === "ai" && (
          <div className="workspace-main-scroll workspace-main-scroll--with-footer">
            <AiSettingsSection />
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
