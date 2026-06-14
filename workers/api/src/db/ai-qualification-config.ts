import type { Env } from "../env";
import { getAiConfig, type AiConfigRow } from "./ai-config";
import { multiLocationEnabled } from "../capabilities";
import { getOrgLocations } from "./locations";
import { formatNameList } from "../ai/template-render";

export type QualificationField = "name" | "interest" | "location" | "child";

export type FieldLabels = {
  interest: string;
  location: string;
  trial: string;
};

export type QualificationTemplates = Record<string, string>;

export type QualificationConfig = {
  enabled: boolean;
  requiredFields: QualificationField[];
  fieldLabels: FieldLabels;
  programmeAliases: Record<string, string>;
  templates: QualificationTemplates;
};

export const DEFAULT_FIELD_LABELS: FieldLabels = {
  interest: "service",
  location: "location",
  trial: "free consultation",
};

export const DEFAULT_REQUIRED_FIELDS: QualificationField[] = [
  "name",
  "interest",
];

export const DEFAULT_QUALIFICATION_TEMPLATES: QualificationTemplates = {
  greeting:
    "Hey! Happy to help — what's your name and what {{interest_label}} are you interested in?",
  need_name: "Happy to help! What's your name?",
  need_interest:
    "Hey{{first_name}}! What {{interest_label}} are you interested in?",
  need_location:
    "We've got {{location_names}} — which {{location_label}} is nearest you?",
  need_name_and_interest:
    "What's your name and what {{interest_label}} are you looking for?",
  need_all:
    "Happy to help! What's your name and what {{interest_label}} are you looking for?",
  qualified:
    "Thanks{{first_name}}! What days or times usually work for you? Someone from the team will be in touch to confirm your {{trial_label}}.",
};

export function getEffectiveRequiredFields(
  env: Env,
  configured: QualificationField[]
): QualificationField[] {
  if (multiLocationEnabled(env)) return configured;
  return configured.filter((f) => f !== "location");
}

export async function getEffectiveRequiredFieldsForOrg(
  env: Env
): Promise<QualificationField[]> {
  const config = await getQualificationConfig(env);
  return getEffectiveRequiredFields(env, config.requiredFields);
}

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw?.trim()) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export async function getQualificationConfig(
  env: Env
): Promise<QualificationConfig & { aiConfig: AiConfigRow & { organization_id: string } }> {
  const aiConfig = await getAiConfig(env);
  return {
    aiConfig,
    enabled: (aiConfig.qualification_enabled ?? 1) !== 0,
    requiredFields: parseJson(
      aiConfig.required_fields,
      DEFAULT_REQUIRED_FIELDS
    ),
    fieldLabels: {
      ...DEFAULT_FIELD_LABELS,
      ...parseJson<Partial<FieldLabels>>(aiConfig.field_labels, {}),
    },
    programmeAliases: parseJson<Record<string, string>>(
      aiConfig.programme_aliases,
      {}
    ),
    templates: {
      ...DEFAULT_QUALIFICATION_TEMPLATES,
      ...parseJson<QualificationTemplates>(
        aiConfig.qualification_templates,
        {}
      ),
    },
  };
}

export async function listOrgProgrammes(env: Env): Promise<string[]> {
  const { results } = await env.DB.prepare(
    `SELECT DISTINCT programme FROM location_programme_schedules
     WHERE organization_id = ?
     ORDER BY programme ASC`
  )
    .bind(env.ORGANIZATION_ID)
    .all<{ programme: string }>();
  return (results ?? []).map((r) => r.programme);
}

export async function getProgrammeAliases(
  env: Env
): Promise<Record<string, string>> {
  const config = await getQualificationConfig(env);
  const fromSchedules = await listOrgProgrammes(env);
  const aliases: Record<string, string> = { ...config.programmeAliases };
  for (const programme of fromSchedules) {
    aliases[programme.toLowerCase()] = programme;
  }
  return aliases;
}

export async function buildTemplateParams(
  env: Env,
  opts: {
    firstName?: string;
    interest?: string;
    locationName?: string;
  }
): Promise<Record<string, string>> {
  const config = await getQualificationConfig(env);
  const locations = await getOrgLocations(env);
  const programmes = await listOrgProgrammes(env);
  const locationNames = locations.map((l) => l.name);
  const programmeNames =
    programmes.length > 0 ? programmes : [];

  const first = opts.firstName?.trim();
  const firstName = first ? ` ${first}` : "";

  return {
    business_name: config.aiConfig.academy_name,
    first_name: firstName,
    location_names: formatNameList(locationNames) || "our locations",
    programme_names: formatNameList(programmeNames) || config.fieldLabels.interest,
    interest: opts.interest ?? "",
    location_name: opts.locationName ?? "",
    interest_label: config.fieldLabels.interest,
    location_label: config.fieldLabels.location,
    trial_label: config.fieldLabels.trial,
  };
}

export type AiConfigPatch = {
  academyName?: string;
  tone?: string;
  goals?: string;
  rules?: string;
  modelReply?: string;
  modelJudge?: string;
  safeFallbackMessage?: string | null;
  intakeContextLabel?: string | null;
  qualificationEnabled?: boolean;
  requiredFields?: QualificationField[];
  fieldLabels?: Partial<FieldLabels>;
  programmeAliases?: Record<string, string>;
  qualificationTemplates?: Partial<QualificationTemplates>;
  presetId?: string | null;
};

const MAX_TEXT = 4000;

function clamp(s: string, max = MAX_TEXT): string {
  return s.slice(0, max);
}

export function validateAiConfigPatch(body: unknown): AiConfigPatch | string {
  if (!body || typeof body !== "object") return "Invalid body";
  const b = body as Record<string, unknown>;
  const patch: AiConfigPatch = {};

  if (b.academyName !== undefined) {
    if (typeof b.academyName !== "string" || !b.academyName.trim())
      return "academyName required";
    patch.academyName = clamp(b.academyName.trim(), 200);
  }
  if (b.tone !== undefined) patch.tone = clamp(String(b.tone));
  if (b.goals !== undefined) patch.goals = clamp(String(b.goals));
  if (b.rules !== undefined) patch.rules = clamp(String(b.rules));
  if (b.modelReply !== undefined) patch.modelReply = clamp(String(b.modelReply), 120);
  if (b.modelJudge !== undefined) patch.modelJudge = clamp(String(b.modelJudge), 120);
  if (b.safeFallbackMessage !== undefined) {
    patch.safeFallbackMessage =
      b.safeFallbackMessage === null ? null : clamp(String(b.safeFallbackMessage));
  }
  if (b.intakeContextLabel !== undefined) {
    patch.intakeContextLabel =
      b.intakeContextLabel === null ? null : clamp(String(b.intakeContextLabel));
  }
  if (b.qualificationEnabled !== undefined) {
    patch.qualificationEnabled = Boolean(b.qualificationEnabled);
  }
  if (b.requiredFields !== undefined) {
    if (!Array.isArray(b.requiredFields)) return "requiredFields must be array";
    patch.requiredFields = b.requiredFields as QualificationField[];
  }
  if (b.fieldLabels !== undefined) {
    if (typeof b.fieldLabels !== "object" || b.fieldLabels === null)
      return "fieldLabels must be object";
    patch.fieldLabels = b.fieldLabels as Partial<FieldLabels>;
  }
  if (b.programmeAliases !== undefined) {
    if (typeof b.programmeAliases !== "object" || b.programmeAliases === null)
      return "programmeAliases must be object";
    patch.programmeAliases = b.programmeAliases as Record<string, string>;
  }
  if (b.qualificationTemplates !== undefined) {
    if (
      typeof b.qualificationTemplates !== "object" ||
      b.qualificationTemplates === null
    )
      return "qualificationTemplates must be object";
    patch.qualificationTemplates = b.qualificationTemplates as Partial<
      QualificationTemplates
    >;
  }
  if (b.presetId !== undefined) {
    patch.presetId =
      b.presetId === null ? null : clamp(String(b.presetId).trim(), 80);
  }

  return patch;
}

export async function upsertAiConfig(
  env: Env,
  patch: AiConfigPatch
): Promise<void> {
  const existing = await getAiConfig(env);
  const mergedLabels = {
    ...DEFAULT_FIELD_LABELS,
    ...parseJson<Partial<FieldLabels>>(existing.field_labels, {}),
    ...patch.fieldLabels,
  };
  const mergedTemplates = {
    ...DEFAULT_QUALIFICATION_TEMPLATES,
    ...parseJson<QualificationTemplates>(existing.qualification_templates, {}),
    ...patch.qualificationTemplates,
  };
  const mergedAliases = {
    ...parseJson<Record<string, string>>(existing.programme_aliases, {}),
    ...patch.programmeAliases,
  };

  await env.DB.prepare(
    `INSERT INTO ai_config (
      organization_id, academy_name, tone, goals, rules, model_reply, model_judge,
      safe_fallback_message, intake_context_label,
      qualification_enabled, required_fields, field_labels, programme_aliases, qualification_templates,
      preset_id, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(organization_id) DO UPDATE SET
      academy_name = excluded.academy_name,
      tone = excluded.tone,
      goals = excluded.goals,
      rules = excluded.rules,
      model_reply = excluded.model_reply,
      model_judge = excluded.model_judge,
      safe_fallback_message = excluded.safe_fallback_message,
      intake_context_label = excluded.intake_context_label,
      qualification_enabled = excluded.qualification_enabled,
      required_fields = excluded.required_fields,
      field_labels = excluded.field_labels,
      programme_aliases = excluded.programme_aliases,
      qualification_templates = excluded.qualification_templates,
      preset_id = excluded.preset_id,
      updated_at = datetime('now')`
  )
    .bind(
      env.ORGANIZATION_ID,
      patch.academyName ?? existing.academy_name,
      patch.tone ?? existing.tone,
      patch.goals ?? existing.goals,
      patch.rules ?? existing.rules,
      patch.modelReply ?? existing.model_reply,
      patch.modelJudge ?? existing.model_judge,
      patch.safeFallbackMessage !== undefined
        ? patch.safeFallbackMessage
        : existing.safe_fallback_message,
      patch.intakeContextLabel !== undefined
        ? patch.intakeContextLabel
        : existing.intake_context_label,
      patch.qualificationEnabled !== undefined
        ? patch.qualificationEnabled
          ? 1
          : 0
        : existing.qualification_enabled ?? 1,
      JSON.stringify(patch.requiredFields ?? parseJson(existing.required_fields, DEFAULT_REQUIRED_FIELDS)),
      JSON.stringify(mergedLabels),
      JSON.stringify(mergedAliases),
      JSON.stringify(mergedTemplates),
      patch.presetId !== undefined ? patch.presetId : existing.preset_id ?? null
    )
    .run();
}
