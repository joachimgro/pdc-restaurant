import type { Env } from "../env";

const HEARTBEAT_META_KEY = "cron_last_ok_at";

/**
 * Persist last successful cron tick (ISO) to `_meta.cron_last_ok_at`.
 * External uptime monitors should poll `/health` — there is no outbound ping.
 */
export async function recordCronHeartbeat(env: Env): Promise<void> {
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO _meta (key, value, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
  )
    .bind(HEARTBEAT_META_KEY, now)
    .run();
}

export async function readCronHeartbeat(
  env: Env
): Promise<{ lastOkAt: string | null; stale: boolean }> {
  const row = await env.DB.prepare(
    `SELECT value FROM _meta WHERE key = ?`
  )
    .bind(HEARTBEAT_META_KEY)
    .first<{ value: string }>();
  const lastOkAt = row?.value ?? null;
  if (!lastOkAt) return { lastOkAt: null, stale: true };
  const ageMs = Date.now() - new Date(lastOkAt).getTime();
  // Cron runs every 5 min; 15 min with no stamp → stale for /health.
  return { lastOkAt, stale: ageMs > 15 * 60 * 1000 };
}
