import type { KnowledgeChunk } from "@lead-intake/knowledge";
import type { Env } from "../env";
import { embedText } from "../ai/workers-ai";
import { setIngestMeta } from "./ai-config";
import { collectChunksForIngest } from "./knowledge-chunks";

async function upsertChunkVectors(
  env: Env,
  chunks: KnowledgeChunk[]
): Promise<number> {
  if (!env.KNOWLEDGE || !env.AI) {
    throw new Error("KNOWLEDGE or AI binding not configured");
  }

  const vectors: {
    id: string;
    values: number[];
    metadata: Record<string, string>;
  }[] = [];

  for (const chunk of chunks) {
    const values = await embedText(env, chunk.text);
    vectors.push({
      id: chunk.id,
      values,
      metadata: {
        organization_id: chunk.organizationId,
        location_id: chunk.locationId ?? "_global",
        chunk_id: chunk.id,
        title: chunk.title,
        source: chunk.source,
        text: chunk.text.slice(0, 800),
      },
    });
  }

  const batchSize = 20;
  for (let i = 0; i < vectors.length; i += batchSize) {
    await env.KNOWLEDGE.upsert(vectors.slice(i, i + batchSize));
  }

  return vectors.length;
}

export async function ingestKnowledgeIndex(env: Env): Promise<{
  ok: boolean;
  chunkCount: number;
  error?: string;
}> {
  if (!env.KNOWLEDGE || !env.AI) {
    return {
      ok: false,
      chunkCount: 0,
      error: "KNOWLEDGE or AI binding not configured",
    };
  }

  try {
    const chunks = await collectChunksForIngest(env);
    const count = await upsertChunkVectors(env, chunks);
    await setIngestMeta(env, count);
    return { ok: true, chunkCount: count };
  } catch (e) {
    return {
      ok: false,
      chunkCount: 0,
      error: e instanceof Error ? e.message : "Ingest failed",
    };
  }
}

/** Upsert a single chunk into Vectorize after portal create/update. */
export async function upsertSingleChunk(
  env: Env,
  chunk: KnowledgeChunk
): Promise<void> {
  await upsertChunkVectors(env, [chunk]);
}

/** Remove one vector from the index. */
export async function deleteChunkVector(
  env: Env,
  chunkId: string
): Promise<void> {
  if (!env.KNOWLEDGE) return;
  try {
    await env.KNOWLEDGE.deleteByIds([chunkId]);
  } catch (e) {
    console.warn("Vectorize deleteByIds failed", chunkId, e);
  }
}
