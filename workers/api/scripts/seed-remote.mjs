#!/usr/bin/env node
/**
 * Seed remote D1 via deployed Worker (reads NEXT_PUBLIC_API_URL or WORKER_URL)
 */
const base = process.env.WORKER_URL || process.env.NEXT_PUBLIC_API_URL;
if (!base) {
  console.error("Set WORKER_URL in .env before running this script");
  process.exit(1);
}

const res = await fetch(`${base}/admin/seed`, { method: "POST" });
const body = await res.text();
console.log(res.status, body);
if (!res.ok) process.exit(1);
