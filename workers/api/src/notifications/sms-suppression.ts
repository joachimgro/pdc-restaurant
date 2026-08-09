import type { Env } from "../env";
import { canonicalPhone } from "../db/phone-utils";

const STOP_WORDS = new Set([
  "STOP",
  "STOPALL",
  "UNSUBSCRIBE",
  "CANCEL",
  "END",
  "QUIT",
]);
const START_WORDS = new Set(["START", "UNSTOP", "YES"]);

export type SmsKeyword = "stop" | "start" | null;

export function parseSmsKeyword(text: string): SmsKeyword {
  const token = text.trim().split(/\s+/)[0]?.toUpperCase() ?? "";
  if (STOP_WORDS.has(token)) return "stop";
  if (START_WORDS.has(token)) return "start";
  return null;
}

export async function suppressSmsPhone(
  env: Env,
  phone: string,
  source = "stop"
): Promise<void> {
  const phoneE164 = canonicalPhone(phone);
  if (!phoneE164) return;
  await env.DB.prepare(
    `INSERT INTO sms_suppressions (organization_id, phone_e164, suppressed_at, source)
     VALUES (?, ?, datetime('now'), ?)
     ON CONFLICT(organization_id, phone_e164) DO UPDATE SET
       suppressed_at = datetime('now'), source = excluded.source`
  )
    .bind(env.ORGANIZATION_ID, phoneE164, source)
    .run();
}

export async function unsuppressSmsPhone(env: Env, phone: string): Promise<void> {
  const phoneE164 = canonicalPhone(phone);
  if (!phoneE164) return;
  await env.DB.prepare(
    `DELETE FROM sms_suppressions WHERE organization_id = ? AND phone_e164 = ?`
  )
    .bind(env.ORGANIZATION_ID, phoneE164)
    .run();
}

export async function isSmsSuppressed(
  env: Env,
  phone: string
): Promise<boolean> {
  const phoneE164 = canonicalPhone(phone);
  if (!phoneE164) return false;
  const row = await env.DB.prepare(
    `SELECT 1 AS ok FROM sms_suppressions
     WHERE organization_id = ? AND phone_e164 = ?`
  )
    .bind(env.ORGANIZATION_ID, phoneE164)
    .first<{ ok: number }>();
  return Boolean(row);
}
