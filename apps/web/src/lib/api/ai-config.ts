import { apiFetch } from "./client";

export type QualificationField = "name" | "interest" | "location" | "child";

export type FieldLabels = {
  interest: string;
  location: string;
  trial: string;
};

export type AiConfigDto = {
  academyName: string;
  tone: string;
  goals: string;
  rules: string;
  modelReply: string;
  modelJudge: string;
  safeFallbackMessage: string | null;
  intakeContextLabel: string | null;
  qualificationEnabled: boolean;
  requiredFields: QualificationField[];
  fieldLabels: FieldLabels;
  programmeAliases: Record<string, string>;
  qualificationTemplates: Record<string, string>;
  presetId?: string;
};

export type AiPresetSummary = { id: string; label: string };

export async function fetchAiConfig(): Promise<{
  config: AiConfigDto;
  presets: AiPresetSummary[];
}> {
  return apiFetch("/admin/ai-config");
}

export async function patchAiConfig(
  patch: Partial<{
    academyName: string;
    tone: string;
    goals: string;
    rules: string;
    modelReply: string;
    modelJudge: string;
    safeFallbackMessage: string | null;
    intakeContextLabel: string | null;
    qualificationEnabled: boolean;
    requiredFields: QualificationField[];
    fieldLabels: Partial<FieldLabels>;
    programmeAliases: Record<string, string>;
    qualificationTemplates: Record<string, string>;
  }>
): Promise<{
  ok: boolean;
  config: AiConfigDto;
  ragSynced?: boolean;
  chunkCount?: number;
}> {
  return apiFetch("/admin/ai-config", {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export async function applyAiPreset(
  presetId: string
): Promise<{ ok: boolean; presetId: string; config: AiConfigDto }> {
  return apiFetch("/admin/ai-config/apply-preset", {
    method: "POST",
    body: JSON.stringify({ presetId }),
  });
}
