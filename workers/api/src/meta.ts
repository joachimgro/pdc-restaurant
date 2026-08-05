import type { Env } from "./env";

/**
 * The migration version this Worker build expects to find in D1.
 * MUST match the highest-numbered migration file in workers/api/migrations/.
 * If D1 reports a lower version, the Worker will refuse to serve traffic.
 */
export const EXPECTED_SCHEMA_VERSION = "0036";

// Module-level cache — set once per Worker instance
let schemaVersionVerified: boolean | null = null;
let schemaVersionError: string | null = null;

export async function verifySchemaVersion(env: Env): Promise<void> {
  if (schemaVersionVerified === true) return;
  if (schemaVersionVerified === false) {
    throw new Error(schemaVersionError || "Schema version check failed");
  }

  try {
    const row = await env.DB.prepare(
      "SELECT value FROM _meta WHERE key = 'schema_version'"
    ).first<{ value: string }>();

    const actual = row?.value || "0000";
    if (actual < EXPECTED_SCHEMA_VERSION) {
      schemaVersionVerified = false;
      schemaVersionError = `D1 schema is at version ${actual}, but this Worker expects ${EXPECTED_SCHEMA_VERSION}. Run 'pnpm deploy:remote' to apply migrations before deploying.`;
      console.error(`[${env.ORGANIZATION_ID}] ${schemaVersionError}`);
      throw new Error(schemaVersionError);
    }

    schemaVersionVerified = true;
  } catch (e) {
    const msg = String(e);
    // Pre-Phase-4 deployment: _meta table missing — allow but warn loudly
    if (msg.includes("no such table") || msg.includes("_meta")) {
      console.warn(
        `[${env.ORGANIZATION_ID}] _meta table missing — apply latest migrations`
      );
      schemaVersionVerified = true;
      return;
    }
    if (schemaVersionVerified === false) throw e;
    schemaVersionVerified = false;
    schemaVersionError = msg;
    throw e;
  }
}
