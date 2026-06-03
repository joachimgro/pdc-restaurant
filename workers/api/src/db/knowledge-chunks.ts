import type { KnowledgeChunk } from "@lead-intake/knowledge";
import { KNOWLEDGE_CHUNKS } from "@lead-intake/knowledge";
import type { Env } from "../env";

export type KnowledgeChunkSource = "bundled" | "portal";

export interface ListedKnowledgeChunk {
  id: string;
  organizationId: string;
  locationId: string | null;
  title: string;
  source: string;
  text: string;
  origin: KnowledgeChunkSource;
  editable: boolean;
  createdAt?: string;
}

type ChunkRow = {
  id: string;
  organization_id: string;
  location_id: string | null;
  title: string;
  source: string;
  text: string;
  created_at: string;
};

function rowToChunk(row: ChunkRow): ListedKnowledgeChunk {
  return {
    id: row.id,
    organizationId: row.organization_id,
    locationId: row.location_id,
    title: row.title,
    source: row.source,
    text: row.text,
    origin: "portal",
    editable: true,
    createdAt: row.created_at,
  };
}

export async function listPortalChunks(
  env: Env
): Promise<ListedKnowledgeChunk[]> {
  const { results } = await env.DB.prepare(
    `SELECT id, organization_id, location_id, title, source, text, created_at
     FROM knowledge_chunks
     WHERE organization_id = ?
     ORDER BY created_at DESC`
  )
    .bind(env.ORGANIZATION_ID)
    .all<ChunkRow>();

  return (results ?? []).map(rowToChunk);
}

export function listBundledChunks(orgId: string): ListedKnowledgeChunk[] {
  return KNOWLEDGE_CHUNKS.filter((c) => c.organizationId === orgId).map(
    (c) => ({
      ...c,
      origin: "bundled" as const,
      editable: false,
    })
  );
}

export async function listAllKnowledgeChunks(
  env: Env
): Promise<ListedKnowledgeChunk[]> {
  const portal = await listPortalChunks(env);
  const bundled = listBundledChunks(env.ORGANIZATION_ID);
  return [...portal, ...bundled];
}

async function listIngestChunks(env: Env): Promise<ListedKnowledgeChunk[]> {
  const { results } = await env.DB.prepare(
    `SELECT id, organization_id, location_id, title, source, text, created_at
     FROM knowledge_chunks
     WHERE organization_id = ? AND source IN ('portal', 'schedule')
     ORDER BY created_at DESC`
  )
    .bind(env.ORGANIZATION_ID)
    .all<ChunkRow>();

  return (results ?? []).map((r) => ({
    ...rowToChunk(r),
    origin: "portal" as const,
    editable: r.source === "portal",
  }));
}

/** Chunks to embed into Vectorize (portal + schedule + bundled). */
export async function collectChunksForIngest(
  env: Env
): Promise<KnowledgeChunk[]> {
  const managed = await listIngestChunks(env);
  const bundled = listBundledChunks(env.ORGANIZATION_ID);

  const toKnowledge = (c: ListedKnowledgeChunk): KnowledgeChunk => ({
    id: c.id,
    organizationId: c.organizationId,
    locationId: c.locationId,
    title: c.title,
    source: c.source,
    text: c.text,
  });

  const bundledIds = new Set(bundled.map((b) => b.id));
  const managedFiltered = managed.filter((m) => !bundledIds.has(m.id));

  return [
    ...managedFiltered.map(toKnowledge),
    ...bundled.map(toKnowledge),
  ];
}

export async function createPortalChunk(
  env: Env,
  input: {
    title: string;
    text: string;
    locationId?: string | null;
  }
): Promise<ListedKnowledgeChunk> {
  const id = `portal-${crypto.randomUUID().slice(0, 12)}`;
  const locationId = input.locationId?.trim() || null;

  await env.DB.prepare(
    `INSERT INTO knowledge_chunks (id, organization_id, location_id, title, source, text)
     VALUES (?, ?, ?, ?, 'portal', ?)`
  )
    .bind(
      id,
      env.ORGANIZATION_ID,
      locationId,
      input.title.trim(),
      input.text.trim()
    )
    .run();

  const row = await env.DB.prepare(
    `SELECT id, organization_id, location_id, title, source, text, created_at
     FROM knowledge_chunks WHERE id = ?`
  )
    .bind(id)
    .first<ChunkRow>();

  if (!row) throw new Error("Failed to create knowledge chunk");
  return rowToChunk(row);
}

export async function deletePortalChunk(
  env: Env,
  id: string
): Promise<boolean> {
  if (!id.startsWith("portal-")) return false;

  const result = await env.DB.prepare(
    `DELETE FROM knowledge_chunks WHERE id = ? AND organization_id = ?`
  )
    .bind(id, env.ORGANIZATION_ID)
    .run();

  return (result.meta.changes ?? 0) > 0;
}

export async function getPortalChunk(
  env: Env,
  id: string
): Promise<KnowledgeChunk | null> {
  const row = await env.DB.prepare(
    `SELECT id, organization_id, location_id, title, source, text
     FROM knowledge_chunks WHERE id = ? AND organization_id = ?`
  )
    .bind(id, env.ORGANIZATION_ID)
    .first<{
      id: string;
      organization_id: string;
      location_id: string | null;
      title: string;
      source: string;
      text: string;
    }>();

  if (!row) return null;
  return {
    id: row.id,
    organizationId: row.organization_id,
    locationId: row.location_id,
    title: row.title,
    source: row.source,
    text: row.text,
  };
}
