#!/usr/bin/env node
/**
 * Seed remote D1 via deployed Worker (reads NEXT_PUBLIC_API_URL or WORKER_URL)
 */
const base = process.env.WORKER_URL || process.env.NEXT_PUBLIC_API_URL;
if (!base) {
  console.error(
    "Set WORKER_URL (or NEXT_PUBLIC_API_URL) to your deployed Worker URL, e.g. https://pdc-acme.<subdomain>.workers.dev"
  );
  process.exit(1);
}

const res = await fetch(`${base}/admin/seed`, { method: "POST" });
const body = await res.text();
console.log(res.status, body);
if (!res.ok) process.exit(1);
