import { API_URL } from "./client";

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

async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  const json = await res.json();
  if (!res.ok) {
    throw new Error((json as { error?: string }).error ?? `API ${res.status}`);
  }
  return json as T;
}

export async function fetchKnowledge(): Promise<KnowledgeListResponse> {
  return apiJson("/admin/knowledge");
}

export async function createKnowledgeChunk(input: {
  title: string;
  text: string;
  locationId: string | null;
}): Promise<{ ok: boolean; chunk: KnowledgeChunkItem }> {
  return apiJson("/admin/knowledge", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function deleteKnowledgeChunk(id: string): Promise<void> {
  await apiJson(`/admin/knowledge/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export async function reindexKnowledge(): Promise<{
  ok: boolean;
  chunkCount: number;
  message: string;
}> {
  return apiJson("/admin/knowledge/reindex", { method: "POST" });
}

export async function previewKnowledge(input: {
  query: string;
  locationId?: string;
  interest?: string;
}): Promise<KnowledgePreviewResponse> {
  return apiJson("/admin/knowledge/preview", {
    method: "POST",
    body: JSON.stringify(input),
  });
}
