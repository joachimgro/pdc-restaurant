import type { Env } from "../env";

export interface AiConfigRow {
  organization_id: string;
  academy_name: string;
  tone: string;
  goals: string;
  rules: string;
  model_reply: string;
  model_judge: string;
}

const DEFAULT_CONFIG: Omit<AiConfigRow, "organization_id"> = {
  academy_name: "TODO: Set academy name in Admin → AI Config",
  tone:
    "Sound like a real person at the desk — warm, upbeat, human. British English. Contractions welcome. Never robotic.",
  goals:
    "Be helpful every message. Answer what they asked, then advance toward a free trial or booking. Never repeat the same opener or re-ask answered questions.",
  rules:
    "Under 300 characters. One clear next step per message. No medical advice. Facts from knowledge only. Never dead-end without something useful.",
  model_reply: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
  model_judge: "@cf/meta/llama-3.1-8b-instruct",
};

export async function getAiConfig(
  env: Env
): Promise<AiConfigRow & { organization_id: string }> {
  const row = await env.DB.prepare(
    `SELECT organization_id, academy_name, tone, goals, rules, model_reply, model_judge
     FROM ai_config WHERE organization_id = ?`
  )
    .bind(env.ORGANIZATION_ID)
    .first<AiConfigRow>();

  if (row) return row;

  return { organization_id: env.ORGANIZATION_ID, ...DEFAULT_CONFIG };
}

export async function getLocationOverride(
  db: D1Database,
  locationId: string | undefined
): Promise<string | null> {
  if (!locationId) return null;
  const row = await db
    .prepare(
      `SELECT extra_context FROM ai_location_overrides WHERE location_id = ?`
    )
    .bind(locationId)
    .first<{ extra_context: string }>();
  return row?.extra_context ?? null;
}

export async function getIngestMeta(
  env: Env
): Promise<{ chunk_count: number; ingested_at: string | null }> {
  const row = await env.DB.prepare(
    `SELECT chunk_count, ingested_at FROM ai_ingest_meta WHERE organization_id = ?`
  )
    .bind(env.ORGANIZATION_ID)
    .first<{ chunk_count: number; ingested_at: string }>();

  return {
    chunk_count: row?.chunk_count ?? 0,
    ingested_at: row?.ingested_at ?? null,
  };
}

export async function setIngestMeta(
  env: Env,
  chunkCount: number
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO ai_ingest_meta (organization_id, chunk_count, ingested_at)
     VALUES (?, ?, datetime('now'))
     ON CONFLICT(organization_id) DO UPDATE SET
       chunk_count = excluded.chunk_count,
       ingested_at = excluded.ingested_at`
  )
    .bind(env.ORGANIZATION_ID, chunkCount)
    .run();
}
