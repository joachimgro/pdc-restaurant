import { jsonResponse } from "../cors";
import { getAiConfig, getIngestMeta } from "../db/ai-config";
import {
  getQualificationConfig,
  upsertAiConfig,
  validateAiConfigPatch,
} from "../db/ai-qualification-config";
import { ingestKnowledgeIndex } from "../db/knowledge-ingest";
import { syncAllOrgSchedulesToKnowledge } from "../db/schedule-knowledge";
import { listAiPresets, getAiPreset } from "../ai/presets-loader";
import { aiEnabled } from "../ai/workers-ai";
import { ragEnabled } from "../ai/rag";
import type { Env } from "../env";

const INGEST_CONFIRM = "INGEST KNOWLEDGE";

function checkAdminSecret(request: Request, env: Env): boolean {
  const secret = env.ADMIN_SEED_SECRET;
  if (!secret) return true;
  return request.headers.get("X-Admin-Secret") === secret;
}

function serializeConfig(
  config: Awaited<ReturnType<typeof getQualificationConfig>>
) {
  const { aiConfig } = config;
  return {
    academyName: aiConfig.academy_name,
    tone: aiConfig.tone,
    goals: aiConfig.goals,
    rules: aiConfig.rules,
    modelReply: aiConfig.model_reply,
    modelJudge: aiConfig.model_judge,
    safeFallbackMessage: aiConfig.safe_fallback_message,
    intakeContextLabel: aiConfig.intake_context_label,
    qualificationEnabled: config.enabled,
    requiredFields: config.requiredFields,
    fieldLabels: config.fieldLabels,
    programmeAliases: config.programmeAliases,
    qualificationTemplates: config.templates,
    presetId: aiConfig.preset_id ?? "generic-service",
  };
}

export async function handleAiConfig(
  request: Request,
  env: Env
): Promise<Response> {
  const config = await getQualificationConfig(env);
  const meta = await getIngestMeta(env);
  return jsonResponse(request, env, {
    config: serializeConfig(config),
    presets: listAiPresets(),
    ingest: meta,
  });
}

export async function handlePatchAiConfig(
  request: Request,
  env: Env
): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse(request, env, { error: "Invalid JSON" }, 400);
  }

  const validated = validateAiConfigPatch(body);
  if (typeof validated === "string") {
    return jsonResponse(request, env, { error: validated }, 400);
  }

  await upsertAiConfig(env, validated);
  await syncAllOrgSchedulesToKnowledge(env);
  const ingest = await ingestKnowledgeIndex(env);
  const config = await getQualificationConfig(env);
  return jsonResponse(request, env, {
    ok: true,
    config: serializeConfig(config),
    ragSynced: ingest.ok,
    chunkCount: ingest.ok ? ingest.chunkCount : undefined,
    ragError: ingest.ok ? undefined : ingest.error,
  });
}

export async function handleApplyAiPreset(
  request: Request,
  env: Env
): Promise<Response> {
  let body: { presetId?: string };
  try {
    body = (await request.json()) as { presetId?: string };
  } catch {
    return jsonResponse(request, env, { error: "Invalid JSON" }, 400);
  }

  const presetId = body.presetId?.trim();
  if (!presetId) {
    return jsonResponse(request, env, { error: "presetId required" }, 400);
  }

  const preset = getAiPreset(presetId);
  if (!preset) {
    return jsonResponse(request, env, { error: "Unknown preset" }, 404);
  }

  await upsertAiConfig(env, {
    presetId,
    fieldLabels: preset.fieldLabels,
    requiredFields: preset.requiredFields,
    qualificationTemplates: preset.qualificationTemplates,
    programmeAliases: preset.programmeAliases,
    qualificationEnabled: true,
    ...(preset.defaultTone ? { tone: preset.defaultTone } : {}),
    ...(preset.defaultGoals ? { goals: preset.defaultGoals } : {}),
    ...(preset.defaultRules ? { rules: preset.defaultRules } : {}),
  });
  await syncAllOrgSchedulesToKnowledge(env);
  const ingest = await ingestKnowledgeIndex(env);

  const config = await getQualificationConfig(env);
  return jsonResponse(request, env, {
    ok: true,
    presetId,
    config: serializeConfig(config),
    ragSynced: ingest.ok,
    chunkCount: ingest.ok ? ingest.chunkCount : undefined,
  });
}

export async function handleAiStatus(
  request: Request,
  env: Env
): Promise<Response> {
  const config = await getAiConfig(env);
  const meta = await getIngestMeta(env);

  return jsonResponse(request, env, {
    aiEnabled: aiEnabled(env),
    ragEnabled: ragEnabled(env),
    aiDisabled: env.AI_DISABLED === "true",
    models: {
      reply: config.model_reply,
      judge: config.model_judge,
      embed: env.AI_EMBED_MODEL ?? "@cf/baai/bge-base-en-v1.5",
    },
    knowledge: {
      chunkCount: meta.chunk_count,
      lastIngestedAt: meta.ingested_at,
    },
  });
}

export async function handleIngestKnowledge(
  request: Request,
  env: Env
): Promise<Response> {
  if (!checkAdminSecret(request, env)) {
    return jsonResponse(request, env, { error: "Unauthorized" }, 401);
  }

  let body: { confirm?: string } = {};
  try {
    const text = await request.text();
    if (text) body = JSON.parse(text) as { confirm?: string };
  } catch {
    return jsonResponse(request, env, { error: "Invalid JSON" }, 400);
  }

  if (body.confirm !== INGEST_CONFIRM) {
    return jsonResponse(
      request,
      env,
      {
        error: `Send { "confirm": "${INGEST_CONFIRM}" }`,
      },
      400
    );
  }

  const result = await ingestKnowledgeIndex(env);
  if (!result.ok) {
    return jsonResponse(
      request,
      env,
      { ok: false, error: result.error },
      503
    );
  }

  return jsonResponse(request, env, {
    ok: true,
    chunkCount: result.chunkCount,
    message: `Indexed ${result.chunkCount} knowledge chunks.`,
  });
}
