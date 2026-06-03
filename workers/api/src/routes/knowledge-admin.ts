import { z } from "zod";
import { jsonResponse } from "../cors";
import { getIngestMeta, setIngestMeta } from "../db/ai-config";
import {
  createPortalChunk,
  deletePortalChunk,
  collectChunksForIngest,
  listAllKnowledgeChunks,
} from "../db/knowledge-chunks";
import {
  deleteChunkVector,
  ingestKnowledgeIndex,
  upsertSingleChunk,
} from "../db/knowledge-ingest";
import { previewKnowledge } from "../ai/preview";
import { aiEnabled } from "../ai/workers-ai";
import { ragEnabled } from "../ai/rag";
import type { Env } from "../env";

const CreateChunkSchema = z.object({
  title: z.string().min(1).max(120),
  text: z.string().min(1).max(4000),
  locationId: z.string().nullable().optional(),
});

const PreviewSchema = z.object({
  query: z.string().min(1).max(1500),
  locationId: z.string().optional(),
  interest: z.string().optional(),
});

function checkAdminSecret(request: Request, env: Env): boolean {
  const secret = env.ADMIN_SEED_SECRET;
  if (!secret) return true;
  return request.headers.get("X-Admin-Secret") === secret;
}

export async function handleListKnowledge(
  request: Request,
  env: Env
): Promise<Response> {
  const chunks = await listAllKnowledgeChunks(env);
  const meta = await getIngestMeta(env);

  return jsonResponse(request, env, {
    chunks: chunks.map((c) => ({
      id: c.id,
      title: c.title,
      text: c.text,
      locationId: c.locationId,
      source: c.source,
      origin: c.origin,
      editable: c.editable,
      createdAt: c.createdAt,
    })),
    ingest: meta,
    status: {
      ragEnabled: ragEnabled(env),
      aiEnabled: aiEnabled(env),
    },
  });
}

export async function handleCreateKnowledge(
  request: Request,
  env: Env
): Promise<Response> {
  if (!checkAdminSecret(request, env)) {
    return jsonResponse(request, env, { error: "Unauthorized" }, 401);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse(request, env, { error: "Invalid JSON" }, 400);
  }

  const parsed = CreateChunkSchema.safeParse(body);
  if (!parsed.success) {
    return jsonResponse(
      request,
      env,
      { error: "Validation failed", issues: parsed.error.flatten() },
      400
    );
  }

  const chunk = await createPortalChunk(env, {
    title: parsed.data.title,
    text: parsed.data.text,
    locationId: parsed.data.locationId ?? null,
  });

  if (env.KNOWLEDGE && env.AI) {
    try {
      await upsertSingleChunk(env, {
        id: chunk.id,
        organizationId: chunk.organizationId,
        locationId: chunk.locationId,
        title: chunk.title,
        source: chunk.source,
        text: chunk.text,
      });
      const all = await collectChunksForIngest(env);
      await setIngestMeta(env, all.length);
    } catch (e) {
      console.error("Vector upsert after create failed", e);
    }
  }

  return jsonResponse(request, env, { ok: true, chunk });
}

export async function handleDeleteKnowledge(
  request: Request,
  env: Env,
  id: string
): Promise<Response> {
  if (!checkAdminSecret(request, env)) {
    return jsonResponse(request, env, { error: "Unauthorized" }, 401);
  }

  const removed = await deletePortalChunk(env, id);
  if (!removed) {
    return jsonResponse(
      request,
      env,
      { error: "Not found or cannot delete bundled knowledge" },
      404
    );
  }

  await deleteChunkVector(env, id);

  return jsonResponse(request, env, { ok: true, id });
}

export async function handleReindexKnowledge(
  request: Request,
  env: Env
): Promise<Response> {
  if (!checkAdminSecret(request, env)) {
    return jsonResponse(request, env, { error: "Unauthorized" }, 401);
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
    message: `Re-indexed ${result.chunkCount} chunks into Vectorize.`,
  });
}

export async function handlePreviewKnowledge(
  request: Request,
  env: Env
): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse(request, env, { error: "Invalid JSON" }, 400);
  }

  const parsed = PreviewSchema.safeParse(body);
  if (!parsed.success) {
    return jsonResponse(
      request,
      env,
      { error: "Validation failed", issues: parsed.error.flatten() },
      400
    );
  }

  const result = await previewKnowledge(env, parsed.data);
  return jsonResponse(request, env, result);
}
