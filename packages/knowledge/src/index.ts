export interface KnowledgeChunk {
  id: string;
  organizationId: string;
  locationId: string | null;
  title: string;
  source: string;
  text: string;
}

/**
 * Knowledge chunks ingested into Vectorize via POST /admin/ingest-knowledge.
 *
 * HOW TO POPULATE FOR A NEW CLIENT
 * ─────────────────────────────────
 * 1. Set organizationId to match ORGANIZATION_ID in wrangler.toml.
 * 2. Add one chunk per logical topic (pricing, schedule, FAQ, location, etc.).
 * 3. Keep each chunk's `text` under ~400 words — one clear idea per chunk.
 * 4. Use locationId to scope location-specific chunks (e.g. "london-hq").
 *    Set to null for org-wide knowledge.
 * 5. After populating, run: curl -X POST {WORKER_URL}/admin/ingest-knowledge
 *    or use the Admin panel → "Re-ingest Knowledge".
 *
 * See docs/knowledge-guide.md for detailed guidance and chunk templates.
 */
export const KNOWLEDGE_CHUNKS: KnowledgeChunk[] = [
  // TODO: add your client's knowledge chunks here.
  // Example structure:
  //
  // {
  //   id: "faq-trial",
  //   organizationId: "CHANGE_ME",   // match ORGANIZATION_ID in wrangler.toml
  //   locationId: null,
  //   title: "Free trial policy",
  //   source: "faq.md",
  //   text: "All new members can start with a free trial class ...",
  // },
];
