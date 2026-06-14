import type { Env } from "../env";
import { HARD_LIMIT, getAiCallCount } from "../ai/rate-limit";
import { EXPECTED_SCHEMA_VERSION } from "../meta";
import { GIT_SHA, BUILT_AT } from "../build-info";
import { jsonResponse } from "../cors";

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
    },
    allOk ? 200 : 503
  );
}
