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
 * TIP: Write knowledge in the docs/ folder first as plain markdown,
 * then convert to chunks here. See docs/knowledge-template.md for guidance.
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
  // {
  //   id: "location-main",
  //   organizationId: "CHANGE_ME",
  //   locationId: "main",            // matches a location id in the DB
  //   title: "Main location details",
  //   source: "locations/main.md",
  //   text: "Address, class times, parking, contact ...",
  // },
];
