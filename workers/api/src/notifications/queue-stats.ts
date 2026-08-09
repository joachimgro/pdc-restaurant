import type { Env } from "../env";
import {
  backlogAlertMinutesFromEnv,
  classifySkipReason,
  failed24hAlertFromEnv,
  skipped24hAlertFromEnv,
} from "./policy";

export type NotificationQueueStats = {
  counts: Record<string, number>;
  backlogDueNow: number;
  oldestDueAgeMinutes: number | null;
  oldestDueScheduledFor: string | null;
  failedLast24h: number;
  skippedLast24h: number;
  skippedByReason: Record<string, number>;
  alert: {
    backlogOverdue: boolean;
    failedSpike: boolean;
    skipSpike: boolean;
    backlogThresholdMinutes: number;
    failedThreshold: number;
    skippedThreshold: number;
  };
};

/**
 * Snapshot of the notification queue for /health and ops.
 */
export async function getNotificationQueueStats(
  env: Env,
  opts: { now?: Date } = {}
): Promise<NotificationQueueStats> {
  const now = opts.now ?? new Date();
  const nowIso = now.toISOString();

  const { results: countRows } = await env.DB.prepare(
    `SELECT status, COUNT(*) AS n
     FROM notifications
     WHERE organization_id = ?
     GROUP BY status`
  )
    .bind(env.ORGANIZATION_ID)
    .all<{ status: string; n: number }>();

  const counts: Record<string, number> = {};
  for (const row of countRows ?? []) {
    counts[row.status] = row.n;
  }

  const backlog = await env.DB.prepare(
    `SELECT COUNT(*) AS n,
            MIN(scheduled_for) AS oldest
     FROM notifications
     WHERE organization_id = ?
       AND status = 'scheduled'
       AND scheduled_for IS NOT NULL
       AND scheduled_for <= ?`
  )
    .bind(env.ORGANIZATION_ID, nowIso)
    .first<{ n: number; oldest: string | null }>();

  const failed = await env.DB.prepare(
    `SELECT COUNT(*) AS n
     FROM notifications
     WHERE organization_id = ?
       AND status = 'failed'
       AND updated_at >= datetime('now', '-24 hours')`
  )
    .bind(env.ORGANIZATION_ID)
    .first<{ n: number }>();

  const skipped = await env.DB.prepare(
    `SELECT COUNT(*) AS n
     FROM notifications
     WHERE organization_id = ?
       AND status = 'skipped'
       AND updated_at >= datetime('now', '-24 hours')`
  )
    .bind(env.ORGANIZATION_ID)
    .first<{ n: number }>();

  const { results: skipRows } = await env.DB.prepare(
    `SELECT COALESCE(error_text, '') AS error_text, COUNT(*) AS n
     FROM notifications
     WHERE organization_id = ?
       AND status = 'skipped'
       AND updated_at >= datetime('now', '-24 hours')
     GROUP BY error_text`
  )
    .bind(env.ORGANIZATION_ID)
    .all<{ error_text: string; n: number }>();

  const skippedByReason: Record<string, number> = {};
  for (const row of skipRows ?? []) {
    const reason = classifySkipReason(row.error_text);
    skippedByReason[reason] = (skippedByReason[reason] ?? 0) + row.n;
  }

  const oldest = backlog?.oldest ?? null;
  let oldestDueAgeMinutes: number | null = null;
  if (oldest) {
    oldestDueAgeMinutes = Math.max(
      0,
      Math.floor((now.getTime() - new Date(oldest).getTime()) / 60_000)
    );
  }

  const backlogThresholdMinutes = backlogAlertMinutesFromEnv(env);
  const failedThreshold = failed24hAlertFromEnv(env);
  const skippedThreshold = skipped24hAlertFromEnv(env);
  const backlogDueNow = backlog?.n ?? 0;
  const failedLast24h = failed?.n ?? 0;
  const skippedLast24h = skipped?.n ?? 0;

  return {
    counts,
    backlogDueNow,
    oldestDueAgeMinutes,
    oldestDueScheduledFor: oldest,
    failedLast24h,
    skippedLast24h,
    skippedByReason,
    alert: {
      backlogOverdue:
        oldestDueAgeMinutes != null &&
        oldestDueAgeMinutes > backlogThresholdMinutes,
      failedSpike: failedLast24h > failedThreshold,
      skipSpike: skippedLast24h > skippedThreshold,
      backlogThresholdMinutes,
      failedThreshold,
      skippedThreshold,
    },
  };
}
