#!/usr/bin/env node
/**
 * Mint a staff session cookie against local Miniflare D1 (no Resend).
 *
 * Usage (from repo root, Worker not required):
 *   node scripts/dev-session.mjs
 *   node scripts/dev-session.mjs --email=someone@example.com
 *   node scripts/dev-session.mjs --config=workers/api/wrangler.dev.toml
 *
 * Then in the browser console on the web origin:
 *   document.cookie = "lead_intake_session=<token>; path=/; max-age=2592000"
 *
 * Requires local migrations applied:
 *   cd workers/api && pnpm exec wrangler d1 migrations apply pdc-dev-db --local --config wrangler.dev.toml
 */
import { createHash, randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, unlinkSync, mkdtempSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const API_DIR = join(ROOT, "workers", "api");

const DEFAULT_EMAIL = "joachim@phiof.digital";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const emailArg = process.argv.find((a) => a.startsWith("--email="));
const email = (emailArg ? emailArg.slice("--email=".length) : DEFAULT_EMAIL)
  .trim()
  .toLowerCase();

const configArg = process.argv.find((a) => a.startsWith("--config="));
const WRANGLER_TOML = configArg
  ? join(ROOT, configArg.slice("--config=".length))
  : join(API_DIR, "wrangler.dev.toml");

function readToml(key) {
  const source = readFileSync(WRANGLER_TOML, "utf8");
  const match = source.match(new RegExp(`^\\s*${key}\\s*=\\s*"([^"]+)"`, "m"));
  return match ? match[1] : null;
}

const ORG_ID = readToml("ORGANIZATION_ID") || "dev";
const DB_NAME = readToml("database_name") || "pdc-dev-db";

function hashToken(token) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function q(value) {
  if (value === null || value === undefined) return "NULL";
  return `'${String(value).replace(/'/g, "''")}'`;
}

const rawToken = randomUUID() + randomUUID();
const tokenHash = hashToken(rawToken);
const userId = "dev-session-user";
const sessionId = randomUUID();
const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
const name = email
  .split("@")[0]
  .split(/[._-]+/)
  .filter(Boolean)
  .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
  .join(" ");

const role = email === DEFAULT_EMAIL ? "superadmin" : "admin";

const sql = `
INSERT OR IGNORE INTO organizations (id, name) VALUES (${q(ORG_ID)}, 'Dev Org');
INSERT INTO staff_users (
  id, organization_id, email, name, role, status, profile_complete, display_name
) VALUES (
  ${q(userId)}, ${q(ORG_ID)}, ${q(email)}, ${q(name)}, ${q(role)}, 'active', 1, ${q(name)}
)
ON CONFLICT(id) DO UPDATE SET
  email = excluded.email,
  name = excluded.name,
  role = excluded.role,
  status = 'active',
  profile_complete = 1,
  display_name = excluded.display_name;
DELETE FROM staff_sessions WHERE user_id = ${q(userId)};
INSERT INTO staff_sessions (id, user_id, token_hash, expires_at)
VALUES (${q(sessionId)}, ${q(userId)}, ${q(tokenHash)}, ${q(expiresAt)});
`;

const tmp = mkdtempSync(join(tmpdir(), "dev-session-"));
const sqlPath = join(tmp, "session.sql");
writeFileSync(sqlPath, sql);

try {
  execSync(
    `pnpm exec wrangler d1 execute ${DB_NAME} --local --config ${JSON.stringify(WRANGLER_TOML)} --file ${JSON.stringify(sqlPath)}`,
    { cwd: API_DIR, stdio: "inherit" }
  );
} finally {
  try {
    unlinkSync(sqlPath);
  } catch {
    /* ignore */
  }
}

const maxAge = Math.floor(SESSION_TTL_MS / 1000);
console.log("");
console.log("lead_intake_session cookie minted for", email);
console.log("org:", ORG_ID, "db:", DB_NAME);
console.log("");
console.log("Raw token:");
console.log(rawToken);
console.log("");
console.log("Paste in browser console on the web origin:");
console.log(
  `document.cookie = "lead_intake_session=${rawToken}; path=/; max-age=${maxAge}"`
);
console.log("");
