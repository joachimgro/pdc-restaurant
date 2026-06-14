export interface KnowledgeChunk {
  id: string;
  organizationId: string;
  locationId: string | null;
  title: string;
  source: string;
  text: string;
}

// Client knowledge is managed via the Admin panel and stored in D1.
// Do not add knowledge chunks here — they will cause merge conflicts on base updates.
export const KNOWLEDGE_CHUNKS: KnowledgeChunk[] = [];
