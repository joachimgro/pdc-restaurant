import type { Env } from "../env";

export interface AiConfigRow {
  organization_id: string;
  academy_name: string;
  tone: string;
  goals: string;
  rules: string;
  model_reply: string;
  model_judge: string;
  safe_fallback_message: string | null;
  intake_context_label: string | null;
}

const DEFAULT_INTAKE_CONTEXT_LABEL =
  "(Lead initiated contact via website form)";

const DEFAULT_SAFE_FALLBACK_MESSAGE =
  "Thanks for your message! A member of our team will be in touch shortly.";

const DEFAULT_CONFIG: Omit<AiConfigRow, "organization_id"> = {
  academy_name: "TODO: Set academy name in Admin → AI Config",
  tone: "Friendly, professional, concise",
  goals:
    "Qualify the lead, answer their questions using the knowledge base, and book a trial session",
  rules:
    "Never discuss pricing unless it's in the knowledge base. Never make promises about availability without checking schedules.",
  model_reply: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
  model_judge: "@cf/meta/llama-3.1-8b-instruct",
  safe_fallback_message: null,
  intake_context_label: null,
};

export async function getAiConfig(
  env: Env
): Promise<AiConfigRow & { organization_id: string }> {
  const row = await env.DB.prepare(
    `SELECT organization_id, academy_name, tone, goals, rules, model_reply, model_judge,
            safe_fallback_message, intake_context_label
     FROM ai_config WHERE organization_id = ?`
  )
    .bind(env.ORGANIZATION_ID)
    .first<AiConfigRow>();

  if (row) return row;

  console.warn(
    `[${env.ORGANIZATION_ID}] No ai_config row found — using generic defaults. Configure via Admin panel.`
  );

  return { organization_id: env.ORGANIZATION_ID, ...DEFAULT_CONFIG };
}

export function intakeContextLabelFromConfig(
  config: Pick<AiConfigRow, "intake_context_label">
): string {
  return config.intake_context_label?.trim() || DEFAULT_INTAKE_CONTEXT_LABEL;
}

export async function getSafeFallbackMessage(env: Env): Promise<string> {
  const config = await getAiConfig(env);
  return config.safe_fallback_message?.trim() || DEFAULT_SAFE_FALLBACK_MESSAGE;
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
