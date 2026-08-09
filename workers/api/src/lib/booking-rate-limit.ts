import type { Env } from "../env";

type Bucket = "avail" | "hold" | "reserve" | "write" | "venue_reserve" | "waitlist";

const LIMITS: Record<Bucket, { max: number; windowSec: number }> = {
  avail: { max: 10, windowSec: 60 },
  hold: { max: 5, windowSec: 60 },
  reserve: { max: 3, windowSec: 60 },
  write: { max: 20, windowSec: 3600 },
  venue_reserve: { max: 50, windowSec: 3600 },
  waitlist: { max: 5, windowSec: 60 },
};

/**
 * KV-backed rate limits for public booking. If RATE_LIMITS is unbound,
 * allow (tests / misconfigured demos) — Turnstile still protects writes.
 */
export async function checkBookingRateLimit(
  env: Env,
  bucket: Bucket,
  key: string
): Promise<{ ok: true } | { ok: false }> {
  const kv = env.RATE_LIMITS;
  if (!kv) return { ok: true };

  const { max, windowSec } = LIMITS[bucket];
  const window = Math.floor(Date.now() / 1000 / windowSec);
  const kvKey = `book:${bucket}:${key}:${window}`;

  const raw = await kv.get(kvKey);
  const count = raw ? Number(raw) : 0;
  if (count >= max) return { ok: false };

  await kv.put(kvKey, String(count + 1), { expirationTtl: windowSec + 5 });
  return { ok: true };
}

export function clientIp(request: Request): string {
  return (
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown"
  );
}
