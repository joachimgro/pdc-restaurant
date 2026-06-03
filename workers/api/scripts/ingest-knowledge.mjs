#!/usr/bin/env node
/**
 * POST /admin/ingest-knowledge on deployed (or local) Worker.
 * Usage: node scripts/ingest-knowledge.mjs [API_URL]
 */
const API_URL = process.argv[2] ?? process.env.WORKER_URL;
if (!API_URL) {
  console.error("Usage: node scripts/ingest-knowledge.mjs <API_URL>");
  console.error("  or set WORKER_URL in .env");
  process.exit(1);
}

const res = await fetch(`${API_URL}/admin/ingest-knowledge`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ confirm: "INGEST KNOWLEDGE" }),
});

const text = await res.text();
console.log(res.status, text);

if (!res.ok) process.exit(1);
