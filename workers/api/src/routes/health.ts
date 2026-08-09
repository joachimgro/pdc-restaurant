import type { Env } from "../env";
import { HARD_LIMIT, getAiCallCount } from "../ai/rate-limit";
import { EXPECTED_SCHEMA_VERSION } from "../meta";
import { GIT_SHA, BUILT_AT } from "../build-info";
import { jsonResponse } from "../cors";
import { collectConfigIssues } from "../config-gate";
import { readCronHeartbeat } from "../cron/heartbeat";
import { getNotificationQueueStats } from "../notifications/queue-stats";

export async function handleHealth(
  request: Request,
  env: Env
): Promise<Response> {
  const checks: Record<string, { ok: boolean; details?: string }> = {};

  try {
    const row = await env.DB.prepare(
      "SELECT value FROM _meta WHERE key = 'schema_version'"
    ).first<{ value: string }>();
    const actual = row?.value || "0000";
    checks.schema = {
      ok: actual >= EXPECTED_SCHEMA_VERSION,
      details: `actual=${actual} expected=${EXPECTED_SCHEMA_VERSION}`,
    };
  } catch (e) {
    checks.schema = { ok: false, details: String(e) };
  }

  try {
    await env.DB.prepare("SELECT 1").first();
    checks.d1 = { ok: true };
  } catch (e) {
    checks.d1 = { ok: false, details: String(e) };
  }

  try {
    checks.vectorize = { ok: !!env.KNOWLEDGE };
    if (!env.KNOWLEDGE) {
      checks.vectorize.details = "KNOWLEDGE binding not configured";
    }
  } catch (e) {
    checks.vectorize = { ok: false, details: String(e) };
  }

  if (env.RATE_LIMITS) {
    try {
      const count = await getAiCallCount(env);
      checks.ai_usage = {
        ok: count < HARD_LIMIT,
        details: `${count}/${HARD_LIMIT} calls in window`,
      };
    } catch (e) {
      checks.ai_usage = { ok: false, details: String(e) };
    }
  }

  const configIssues = collectConfigIssues(env);
  checks.config_gate = {
    ok: configIssues.length === 0,
    details:
      configIssues.length === 0
        ? "ok"
        : configIssues.map((i) => `${i.code}: ${i.message}`).join("; "),
  };

  try {
    const hb = await readCronHeartbeat(env);
    checks.cron_heartbeat = {
      ok: !hb.lastOkAt || !hb.stale,
      details: hb.lastOkAt
        ? `last_ok=${hb.lastOkAt}${hb.stale ? " (stale >15m)" : ""}`
        : "no cron tick recorded yet",
    };
  } catch (e) {
    checks.cron_heartbeat = { ok: false, details: String(e) };
  }

  // Deploy drift: optional EXPECTED_GIT_SHA (set in wrangler vars after stamp).
  // Always surface running sha + schema so curl vs git rev-parse is trivial.
  const expectedSha = env.EXPECTED_GIT_SHA?.trim();
  if (expectedSha) {
    checks.deploy_sha = {
      ok: GIT_SHA === expectedSha || GIT_SHA.startsWith(expectedSha),
      details: `running=${GIT_SHA} expected=${expectedSha}`,
    };
  } else {
    checks.deploy_sha = {
      ok: true,
      details: `running=${GIT_SHA} (set EXPECTED_GIT_SHA var to pin)`,
    };
  }

  checks.schema_pin = {
    ok: checks.schema?.ok ?? false,
    details: `d1=${checks.schema?.details ?? "n/a"} worker_expected=${EXPECTED_SCHEMA_VERSION}`,
  };

  let notificationQueue: Awaited<
    ReturnType<typeof getNotificationQueueStats>
  > | null = null;
  try {
    notificationQueue = await getNotificationQueueStats(env);
    const alert = notificationQueue.alert;
    checks.notification_queue = {
      ok: !alert.backlogOverdue && !alert.failedSpike && !alert.skipSpike,
      details: [
        `backlog_due=${notificationQueue.backlogDueNow}`,
        `oldest_due_age_min=${notificationQueue.oldestDueAgeMinutes ?? "n/a"}`,
        `failed_24h=${notificationQueue.failedLast24h}`,
        `skipped_24h=${notificationQueue.skippedLast24h}`,
        `skips=${JSON.stringify(notificationQueue.skippedByReason)}`,
        alert.backlogOverdue
          ? `BACKLOG>${alert.backlogThresholdMinutes}m`
          : null,
        alert.failedSpike ? `FAILED_24H>${alert.failedThreshold}` : null,
        alert.skipSpike ? `SKIPPED_24H>${alert.skippedThreshold}` : null,
      ]
        .filter(Boolean)
        .join("; "),
    };
  } catch (e) {
    checks.notification_queue = { ok: false, details: String(e) };
  }

  const allOk = Object.values(checks).every((c) => c.ok);

  return jsonResponse(
    request,
    env,
    {
      ok: allOk,
      organizationId: env.ORGANIZATION_ID,
      version: {
        gitSha: GIT_SHA,
        builtAt: BUILT_AT,
        expectedSchema: EXPECTED_SCHEMA_VERSION,
      },
      checks,
      notificationQueue: notificationQueue ?? undefined,
      configIssues: configIssues.length ? configIssues : undefined,
    },
    allOk ? 200 : 503
  );
}
