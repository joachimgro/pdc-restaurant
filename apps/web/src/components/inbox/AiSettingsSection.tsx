"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  applyAiPreset,
  fetchAiConfig,
  patchAiConfig,
  type AiConfigDto,
  type AiPresetSummary,
  type QualificationField,
} from "@/lib/api/ai-config";

const TEMPLATE_KEYS = [
  { key: "greeting", label: "Greeting", hint: "First SMS / hi" },
  { key: "need_name", label: "Need name", hint: "Missing name only" },
  { key: "need_interest", label: "Need interest", hint: "Missing service/programme" },
  { key: "need_location", label: "Need location", hint: "Missing venue" },
  { key: "need_name_and_interest", label: "Name + interest", hint: "Both missing" },
  { key: "need_all", label: "Need all", hint: "Multiple fields missing" },
  { key: "qualified", label: "Qualified", hint: "Ready to book" },
] as const;

const FIELD_OPTIONS: { id: QualificationField; label: string }[] = [
  { id: "name", label: "Name" },
  { id: "interest", label: "Interest / service" },
  { id: "location", label: "Location" },
  { id: "child", label: "Child info" },
];

const PARAM_HINT =
  "{{business_name}}, {{first_name}}, {{location_names}}, {{programme_names}}, {{interest}}, {{location_name}}, {{interest_label}}, {{location_label}}, {{trial_label}}";

type Tab = "basics" | "qualification" | "advanced";

export function AiSettingsSection() {
  const [config, setConfig] = useState<AiConfigDto | null>(null);
  const [presets, setPresets] = useState<AiPresetSummary[]>([]);
  const [tab, setTab] = useState<Tab>("basics");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [presetId, setPresetId] = useState("");
  const [showTemplates, setShowTemplates] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchAiConfig();
      setConfig(data.config);
      setPresets(data.presets);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load AI config");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    if (!config) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const result = await patchAiConfig({
        academyName: config.academyName,
        tone: config.tone,
        goals: config.goals,
        rules: config.rules,
        safeFallbackMessage: config.safeFallbackMessage,
        intakeContextLabel: config.intakeContextLabel,
        qualificationEnabled: config.qualificationEnabled,
        requiredFields: config.requiredFields,
        fieldLabels: config.fieldLabels,
        programmeAliases: config.programmeAliases,
        qualificationTemplates: config.qualificationTemplates,
      });
      setConfig(result.config);
      const ragNote = result.ragSynced
        ? ` Knowledge index updated (${result.chunkCount ?? 0} chunks).`
        : "";
      setMessage(`AI settings saved.${ragNote}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const handleApplyPreset = async () => {
    if (!presetId) return;
    if (
      !confirm(
        `Apply "${presets.find((p) => p.id === presetId)?.label ?? presetId}"? This overwrites qualification templates and aliases.`
      )
    ) {
      return;
    }
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const result = await applyAiPreset(presetId);
      setConfig(result.config);
      setMessage(`Preset applied. You can tweak fields below and save.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Preset apply failed");
    } finally {
      setSaving(false);
    }
  };

  const toggleField = (field: QualificationField) => {
    if (!config) return;
    const has = config.requiredFields.includes(field);
    const requiredFields = has
      ? config.requiredFields.filter((f) => f !== field)
      : [...config.requiredFields, field];
    setConfig({ ...config, requiredFields });
  };

  if (loading && !config) {
    return <p className="workspace-msg">Loading AI settings…</p>;
  }

  if (!config) {
    return <p className="workspace-msg error">{error ?? "Could not load AI settings."}</p>;
  }

  return (
    <>
      <div className="workspace-main-header">
        <h2>AI assistant</h2>
        <p className="workspace-main-sub">
          Configure how the assistant talks, what it asks new leads, and how it
          labels your services. Facts and schedules sync to{" "}
          <Link href="/inbox?view=knowledge">Knowledge</Link> when you save.
        </p>
      </div>

      {message && <p className="workspace-msg ok">{message}</p>}
      {error && <p className="workspace-msg error">{error}</p>}

      <div className="settings-tabs">
        {(
          [
            ["basics", "Basics"],
            ["qualification", "Qualification"],
            ["advanced", "Advanced"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={`settings-tab ${tab === id ? "active" : ""}`}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "basics" && (
        <div className="workspace-section">
          <h3>Business persona</h3>
          <div className="workspace-form-grid">
            <label className="workspace-field workspace-field--full">
              <span className="workspace-label">Business name</span>
              <input
                className="workspace-input"
                value={config.academyName}
                onChange={(e) =>
                  setConfig({ ...config, academyName: e.target.value })
                }
              />
            </label>
            <label className="workspace-field workspace-field--full">
              <span className="workspace-label">Tone</span>
              <textarea
                className="workspace-input workspace-textarea"
                rows={2}
                value={config.tone}
                onChange={(e) => setConfig({ ...config, tone: e.target.value })}
              />
            </label>
            <label className="workspace-field workspace-field--full">
              <span className="workspace-label">Goals</span>
              <textarea
                className="workspace-input workspace-textarea"
                rows={2}
                value={config.goals}
                onChange={(e) => setConfig({ ...config, goals: e.target.value })}
              />
            </label>
            <label className="workspace-field workspace-field--full">
              <span className="workspace-label">Rules</span>
              <textarea
                className="workspace-input workspace-textarea"
                rows={3}
                value={config.rules}
                onChange={(e) => setConfig({ ...config, rules: e.target.value })}
              />
            </label>
          </div>

          <h3 style={{ marginTop: 24 }}>Quick start preset</h3>
          <p className="workspace-hint">
            Pick a starting point for your industry — martial arts, music school,
            tuition, or generic. You can edit everything after applying.
          </p>
          <div className="workspace-row">
            <select
              className="workspace-input workspace-select"
              value={presetId}
              onChange={(e) => setPresetId(e.target.value)}
            >
              <option value="">Choose preset…</option>
              {presets.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="workspace-btn workspace-btn--secondary"
              disabled={!presetId || saving}
              onClick={() => void handleApplyPreset()}
            >
              Apply preset
            </button>
          </div>
        </div>
      )}

      {tab === "qualification" && (
        <div className="workspace-section">
          <h3>Inbound SMS qualification</h3>
          <p className="workspace-hint">
            Short scripted replies while you collect name, interest, and location.
            Real questions still go to the full AI with your knowledge base.
          </p>

          <label className="workspace-check">
            <input
              type="checkbox"
              checked={config.qualificationEnabled}
              onChange={(e) =>
                setConfig({ ...config, qualificationEnabled: e.target.checked })
              }
            />
            Enable qualification scripts for inbound SMS
          </label>

          <div className="workspace-chip-group">
            <span className="workspace-label">Required fields</span>
            <div className="workspace-chips">
              {FIELD_OPTIONS.map((f) => (
                <label key={f.id} className="workspace-chip">
                  <input
                    type="checkbox"
                    checked={config.requiredFields.includes(f.id)}
                    onChange={() => toggleField(f.id)}
                  />
                  {f.label}
                </label>
              ))}
            </div>
          </div>

          <div className="workspace-form-grid">
            <label className="workspace-field">
              <span className="workspace-label">Interest label</span>
              <input
                className="workspace-input"
                placeholder="class, instrument, subject…"
                value={config.fieldLabels.interest}
                onChange={(e) =>
                  setConfig({
                    ...config,
                    fieldLabels: {
                      ...config.fieldLabels,
                      interest: e.target.value,
                    },
                  })
                }
              />
            </label>
            <label className="workspace-field">
              <span className="workspace-label">Location label</span>
              <input
                className="workspace-input"
                placeholder="branch, studio, centre…"
                value={config.fieldLabels.location}
                onChange={(e) =>
                  setConfig({
                    ...config,
                    fieldLabels: {
                      ...config.fieldLabels,
                      location: e.target.value,
                    },
                  })
                }
              />
            </label>
            <label className="workspace-field">
              <span className="workspace-label">Booking label</span>
              <input
                className="workspace-input"
                placeholder="free trial, assessment…"
                value={config.fieldLabels.trial}
                onChange={(e) =>
                  setConfig({
                    ...config,
                    fieldLabels: {
                      ...config.fieldLabels,
                      trial: e.target.value,
                    },
                  })
                }
              />
            </label>
          </div>
        </div>
      )}

      {tab === "advanced" && (
        <div className="workspace-section">
          <h3>Fallbacks</h3>
          <div className="workspace-form-grid">
            <label className="workspace-field workspace-field--full">
              <span className="workspace-label">Safe fallback message</span>
              <input
                className="workspace-input"
                value={config.safeFallbackMessage ?? ""}
                onChange={(e) =>
                  setConfig({
                    ...config,
                    safeFallbackMessage: e.target.value || null,
                  })
                }
              />
            </label>
            <label className="workspace-field workspace-field--full">
              <span className="workspace-label">Intake context label</span>
              <input
                className="workspace-input"
                value={config.intakeContextLabel ?? ""}
                onChange={(e) =>
                  setConfig({
                    ...config,
                    intakeContextLabel: e.target.value || null,
                  })
                }
              />
            </label>
          </div>

          <h3 style={{ marginTop: 24 }}>Service aliases</h3>
          <p className="workspace-hint">
            Map how leads phrase things to your canonical service names (one per
            line: <code>alias → Name</code>).
          </p>
          <textarea
            className="workspace-input workspace-textarea"
            rows={6}
            value={Object.entries(config.programmeAliases)
              .map(([k, v]) => `${k} → ${v}`)
              .join("\n")}
            onChange={(e) => {
              const aliases: Record<string, string> = {};
              for (const line of e.target.value.split("\n")) {
                const m = line.match(/^\s*(.+?)\s*→\s*(.+?)\s*$/);
                if (m) aliases[m[1].toLowerCase()] = m[2];
              }
              setConfig({ ...config, programmeAliases: aliases });
            }}
          />

          <button
            type="button"
            className="workspace-btn workspace-btn--secondary"
            style={{ marginTop: 16 }}
            onClick={() => setShowTemplates((v) => !v)}
          >
            {showTemplates ? "Hide" : "Edit"} qualification templates
          </button>

          {showTemplates && (
            <>
              <p className="workspace-hint" style={{ marginTop: 12 }}>
                Params: {PARAM_HINT}
              </p>
              <div className="template-editor-list">
                {TEMPLATE_KEYS.map(({ key, label, hint }) => (
                  <label key={key} className="workspace-field workspace-field--full">
                    <span className="workspace-label">
                      {label}{" "}
                      <span className="workspace-label-muted">({key})</span>
                    </span>
                    <span className="workspace-hint">{hint}</span>
                    <textarea
                      className="workspace-input workspace-textarea"
                      rows={2}
                      value={config.qualificationTemplates[key] ?? ""}
                      onChange={(e) =>
                        setConfig({
                          ...config,
                          qualificationTemplates: {
                            ...config.qualificationTemplates,
                            [key]: e.target.value,
                          },
                        })
                      }
                    />
                  </label>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      <div className="workspace-sticky-footer">
        <button
          type="button"
          className="workspace-btn"
          disabled={saving}
          onClick={() => void save()}
        >
          {saving ? "Saving & syncing…" : "Save & sync to AI"}
        </button>
      </div>
    </>
  );
}
