import type { KnowledgeChunk } from "@lead-intake/knowledge";
import type { Env } from "../env";
import { embedText } from "./workers-ai";

export interface RetrievedChunk extends KnowledgeChunk {
  score: number;
}

export function ragEnabled(env: Env): boolean {
  return Boolean(env.KNOWLEDGE && env.AI);
}

export function buildRagQuery(
  inboundText: string,
  interest: string,
  locationName: string,
  locationId?: string
): string {
  const loc = locationId
    ? `Branch: ${locationName} (${locationId})`
    : `Location: ${locationName}`;
  return `${loc}\nProgramme: ${interest}\nLead asked: ${inboundText}`.slice(
    0,
    1500
  );
}

export async function retrieveKnowledge(
  env: Env,
  organizationId: string,
  locationId: string | undefined,
  queryText: string,
  topK = 5
): Promise<RetrievedChunk[]> {
  if (!env.KNOWLEDGE || !env.AI) return [];

  try {
    const vector = await embedText(env, queryText);
    const results = await env.KNOWLEDGE.query(vector, {
      topK: topK * 2,
      returnMetadata: true,
    });

    const MIN_SCORE = 0.25;

    const matches = results.matches ?? [];
    const filtered: RetrievedChunk[] = [];

    for (const m of matches) {
      if ((m.score ?? 0) < MIN_SCORE) continue;

      const meta = m.metadata as Record<string, string> | undefined;
      if (!meta || meta.organization_id !== organizationId) continue;

      const chunkLocation = meta.location_id ?? "";
      const isGlobal = !chunkLocation || chunkLocation === "_global";
      const matchesLocation =
        isGlobal || (locationId && chunkLocation === locationId);

      if (!matchesLocation) continue;

      filtered.push({
        id: meta.chunk_id ?? m.id,
        organizationId: meta.organization_id,
        locationId: isGlobal ? null : chunkLocation,
        title: meta.title ?? "Knowledge",
        source: meta.source ?? "",
        text: meta.text ?? "",
        score: m.score ?? 0,
      });

      if (filtered.length >= topK) break;
    }

    return filtered;
  } catch (e) {
    console.error("RAG retrieval failed", e);
    return [];
  }
}
