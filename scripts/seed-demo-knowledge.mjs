#!/usr/bin/env node
/**
 * POST knowledge chunks from a JSON pack, then reindex Vectorize.
 *
 * Usage:
 *   WORKER_URL=https://pdc-phiof....workers.dev node scripts/seed-demo-knowledge.mjs demos/oldham-tuition/knowledge-chunks.json
 *   ADMIN_SEED_SECRET=... node scripts/seed-demo-knowledge.mjs path/to/chunks.json https://...
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const packPath = resolve(process.argv[2] ?? "demos/oldham-tuition/knowledge-chunks.json");
const apiUrl = (process.argv[3] ?? process.env.WORKER_URL ?? process.env.NEXT_PUBLIC_API_URL)?.replace(
  /\/$/,
  ""
);

if (!apiUrl) {
  console.error(
    "Usage: node scripts/seed-demo-knowledge.mjs [chunks.json] [API_URL]\nSet WORKER_URL or pass API_URL as second argument."
  );
  process.exit(1);
}

const secret = process.env.ADMIN_SEED_SECRET;
const headers = { "Content-Type": "application/json" };
if (secret) headers["X-Admin-Secret"] = secret;

const chunks = JSON.parse(readFileSync(packPath, "utf8"));
if (!Array.isArray(chunks)) {
  console.error("Pack must be a JSON array of { title, text } objects");
  process.exit(1);
}

console.log(`Seeding ${chunks.length} chunks to ${apiUrl} from ${packPath}`);

for (const chunk of chunks) {
  const res = await fetch(`${apiUrl}/admin/knowledge`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      title: chunk.title,
      text: chunk.text,
      locationId: chunk.locationId ?? null,
    }),
  });
  const body = await res.text();
  console.log(res.status, chunk.title, body.slice(0, 120));
  if (!res.ok) process.exit(1);
}

const reindex = await fetch(`${apiUrl}/admin/knowledge/reindex`, {
  method: "POST",
  headers,
});
const reindexBody = await reindex.text();
console.log("reindex", reindex.status, reindexBody);
if (!reindex.ok) process.exit(1);

console.log("Done.");
