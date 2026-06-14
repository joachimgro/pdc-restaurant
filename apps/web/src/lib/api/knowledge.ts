import { apiFetch } from "./client";

export interface KnowledgeChunkItem {
  id: string;
  title: string;
  text: string;
  locationId: string | null;
  source: string;
  origin: "bundled" | "portal";
  editable: boolean;
  createdAt?: string;
}

export interface KnowledgeListResponse {
  chunks: KnowledgeChunkItem[];
  ingest: { chunk_count: number; ingested_at: string | null };
  status: { ragEnabled: boolean; aiEnabled: boolean };
}

export interface KnowledgePreviewResponse {
  chunks: {
    id: string;
    title: string;
    text: string;
    locationId: string | null;
    source: string;
    score: number;
  }[];
  sampleReply: string | null;
  ragEnabled: boolean;
  aiEnabled: boolean;
}

export async function fetchKnowledge(): Promise<KnowledgeListResponse> {
  return apiFetch("/admin/knowledge");
}

export async function createKnowledgeChunk(input: {
  title: string;
  text: string;
  locationId: string | null;
}): Promise<{ ok: boolean; chunk: KnowledgeChunkItem }> {
  return apiFetch("/admin/knowledge", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function deleteKnowledgeChunk(id: string): Promise<void> {
  await apiFetch(`/admin/knowledge/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export async function reindexKnowledge(): Promise<{
  ok: boolean;
  chunkCount: number;
  message: string;
}> {
  return apiFetch("/admin/knowledge/reindex", { method: "POST" });
}

export async function previewKnowledge(input: {
  query: string;
  locationId?: string;
  interest?: string;
}): Promise<KnowledgePreviewResponse> {
  return apiFetch("/admin/knowledge/preview", {
    method: "POST",
    body: JSON.stringify(input),
  });
}
