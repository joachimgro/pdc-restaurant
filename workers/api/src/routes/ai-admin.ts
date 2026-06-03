import { jsonResponse } from "../cors";
import { getAiConfig, getIngestMeta } from "../db/ai-config";
import { ingestKnowledgeIndex } from "../db/knowledge-ingest";
import { aiEnabled } from "../ai/workers-ai";
import { ragEnabled } from "../ai/rag";
import type { Env } from "../env";

const INGEST_CONFIRM = "INGEST KNOWLEDGE";

function checkAdminSecret(request: Request, env: Env): boolean {
  const secret = env.ADMIN_SEED_SECRET;
  if (!secret) return true;
  return request.headers.get("X-Admin-Secret") === secret;
}

export async function handleAiConfig(
  request: Request,
  env: Env
): Promise<Response> {
  const config = await getAiConfig(env);
  const meta = await getIngestMeta(env);
  return jsonResponse(request, env, {
    config: {
      academyName: config.academy_name,
      tone: config.tone,
      goals: config.goals,
      rules: config.rules,
      modelReply: config.model_reply,
      modelJudge: config.model_judge,
    },
    ingest: meta,
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
