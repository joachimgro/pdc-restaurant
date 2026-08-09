import type { Env } from "../env";

/** Restaurant fork: STOP suppressions table not migrated yet — never suppress. */
export async function isSmsSuppressed(
  _env: Env,
  _phone: string
): Promise<boolean> {
  return false;
}

export function parseSmsKeyword(_body: string): "stop" | "start" | null {
  return null;
}

export async function suppressSmsPhone(
  _env: Env,
  _phone: string,
  _reason: string
): Promise<void> {
  // no-op until 0045 lands on this fork
}
