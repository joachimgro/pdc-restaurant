import type { Env } from "../env";

/**
 * Per-org AI call rate limiting using a 1-hour sliding window.
 * Counts calls in KV; soft-warns and hard-stops at configurable thresholds.
 *
 * Caveat: simple read-modify-write counter can under-count under concurrency
 * (safe direction for rate limiting at current volumes).
 */

const WINDOW_SECONDS = 3600;
export const SOFT_WARN_THRESHOLD = 500;
export const HARD_LIMIT = 1000;

function counterKey(orgId: string): string {
  return `ai-counter:${orgId}`;
}

export async function getAiCallCount(env: Env): Promise<number> {
  if (!env.RATE_LIMITS) return 0;
  return parseInt(
    (await env.RATE_LIMITS.get(counterKey(env.ORGANIZATION_ID))) || "0",
    10
  );
}

export async function checkAiRateLimit(env: Env): Promise<{
  allowed: boolean;
  count: number;
  reason?: string;
}> {
  if (!env.RATE_LIMITS) {
    return { allowed: true, count: 0 };
  }

  const current = await getAiCallCount(env);

  if (current >= HARD_LIMIT) {
    return {
      allowed: false,
      count: current,
      reason: `Rate limit exceeded: ${current}/${HARD_LIMIT} AI calls in window`,
    };
  }

  if (current >= SOFT_WARN_THRESHOLD) {
    console.warn(
      `[${env.ORGANIZATION_ID}] AI call rate approaching limit: ${current}/${HARD_LIMIT}`
    );
  }

  return { allowed: true, count: current };
}

export async function recordAiCall(env: Env): Promise<void> {
  if (!env.RATE_LIMITS) return;

  const key = counterKey(env.ORGANIZATION_ID);
  const current = await getAiCallCount(env);
  await env.RATE_LIMITS.put(key, String(current + 1), {
    expirationTtl: WINDOW_SECONDS,
  });
}
