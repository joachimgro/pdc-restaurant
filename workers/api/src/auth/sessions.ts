import { generateToken, hashToken, isExpired, nowPlusDays } from "./tokens";

const SESSION_TTL_DAYS = 7;

interface SessionRow {
  token_hash: string;
  email: string;
  expires_at: string;
}

/**
 * Create a new session for the given email.
 * Returns the raw (un-hashed) session token to send to the client.
 */
export async function createSession(
  db: D1Database,
  email: string
): Promise<string> {
  const raw = generateToken();
  const hash = await hashToken(raw);
  const expiresAt = nowPlusDays(SESSION_TTL_DAYS);

  await db
    .prepare(
      `INSERT INTO sessions (token_hash, email, expires_at) VALUES (?, ?, ?)`
    )
    .bind(hash, email, expiresAt)
    .run();

  return raw;
}

/**
 * Validate a raw session token.
 * Returns { email } if valid and unexpired, null otherwise.
 */
export async function validateSession(
  db: D1Database,
  rawToken: string
): Promise<{ email: string } | null> {
  const hash = await hashToken(rawToken);
  const row = await db
    .prepare(
      `SELECT email, expires_at FROM sessions WHERE token_hash = ?`
    )
    .bind(hash)
    .first<{ email: string; expires_at: string }>();

  if (!row || isExpired(row.expires_at)) return null;
  return { email: row.email };
}

/**
 * Revoke a session (logout). No-op if the token is not found.
 */
export async function revokeSession(
  db: D1Database,
  rawToken: string
): Promise<void> {
  const hash = await hashToken(rawToken);
  await db
    .prepare(`DELETE FROM sessions WHERE token_hash = ?`)
    .bind(hash)
    .run();
}

/**
 * Delete all expired sessions (run periodically to keep the table clean).
 */
export async function pruneExpiredSessions(db: D1Database): Promise<void> {
  await db
    .prepare(`DELETE FROM sessions WHERE expires_at < datetime('now')`)
    .run();
}
