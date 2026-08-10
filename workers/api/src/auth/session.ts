import type { StaffUser } from "@lead-intake/shared-types";
import type { Env } from "../env";
import {
  canAssignAdmins,
  canManageTeam,
  displayLabelForRow,
  findStaffUserRowById,
  needsProfile,
  type StaffUserRow,
} from "./staff";
import {
  hashToken,
  MAGIC_LINK_TTL_MS,
  randomToken,
  SESSION_COOKIE,
  SESSION_TTL_MS,
} from "./crypto";

export { SESSION_TTL_MS };

export type StaffSession = {
  row: StaffUserRow;
  user: StaffUser;
  displayLabel: string;
};

function rowToPublicUser(row: StaffUserRow): StaffUser {
  return {
    id: row.id,
    email: row.email,
    name: displayLabelForRow(row),
    displayName: row.display_name?.trim() || undefined,
    needsProfile: needsProfile(row),
    canManageTeam: canManageTeam(row.role),
    canAssignAdmins: canAssignAdmins(row.role),
  };
}

export {
  canRequestMagicLink,
  resolveStaffUserOnLogin,
} from "./staff";

export async function createMagicLinkToken(
  env: Env,
  email: string
): Promise<string> {
  const token = randomToken();
  const tokenHash = await hashToken(token);
  const expiresAt = new Date(Date.now() + MAGIC_LINK_TTL_MS).toISOString();

  await env.DB.prepare(
    `INSERT INTO magic_link_tokens (id, email, token_hash, expires_at)
     VALUES (?, ?, ?, ?)`
  )
    .bind(crypto.randomUUID(), email.trim().toLowerCase(), tokenHash, expiresAt)
    .run();

  return token;
}

export async function consumeMagicLinkToken(
  env: Env,
  rawToken: string
): Promise<string | null> {
  const tokenHash = await hashToken(rawToken);
  const row = await env.DB.prepare(
    `SELECT id, email, expires_at, used_at FROM magic_link_tokens
     WHERE token_hash = ?`
  )
    .bind(tokenHash)
    .first<{
      id: string;
      email: string;
      expires_at: string;
      used_at: string | null;
    }>();

  if (!row || row.used_at) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) return null;

  await env.DB.prepare(
    `UPDATE magic_link_tokens SET used_at = datetime('now') WHERE id = ?`
  )
    .bind(row.id)
    .run();

  return row.email;
}

export async function createSession(
  env: Env,
  userId: string
): Promise<string> {
  const token = randomToken();
  const tokenHash = await hashToken(token);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();

  await env.DB.prepare(
    `INSERT INTO staff_sessions (id, user_id, token_hash, expires_at)
     VALUES (?, ?, ?, ?)`
  )
    .bind(crypto.randomUUID(), userId, tokenHash, expiresAt)
    .run();

  return token;
}

export async function deleteSession(env: Env, rawToken: string): Promise<void> {
  const tokenHash = await hashToken(rawToken);
  await env.DB.prepare(`DELETE FROM staff_sessions WHERE token_hash = ?`)
    .bind(tokenHash)
    .run();
}

async function loadSessionRow(
  env: Env,
  rawToken: string
): Promise<(StaffUserRow & { expires_at: string }) | null> {
  const tokenHash = await hashToken(rawToken);
  return env.DB.prepare(
    `SELECT u.id, u.organization_id, u.email, u.name, u.role, u.display_name,
            u.profile_complete, u.invited_by, u.status, s.expires_at
     FROM staff_sessions s
     JOIN staff_users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND u.organization_id = ?`
  )
    .bind(tokenHash, env.ORGANIZATION_ID)
    .first<StaffUserRow & { expires_at: string }>();
}

export async function getStaffSession(
  env: Env,
  request: Request
): Promise<StaffSession | null> {
  const raw = parseSessionCookie(request);
  if (!raw) return null;

  const row = await loadSessionRow(env, raw);
  if (!row) return null;

  if (new Date(row.expires_at).getTime() < Date.now()) {
    const tokenHash = await hashToken(raw);
    await env.DB.prepare(`DELETE FROM staff_sessions WHERE token_hash = ?`)
      .bind(tokenHash)
      .run();
    return null;
  }

  const { expires_at: _, ...userRow } = row;
  return {
    row: userRow,
    user: rowToPublicUser(userRow),
    displayLabel: displayLabelForRow(userRow),
  };
}

export async function getStaffUserFromSession(
  env: Env,
  request: Request
): Promise<StaffUser | null> {
  const session = await getStaffSession(env, request);
  return session?.user ?? null;
}

export async function getStaffSessionById(
  env: Env,
  userId: string
): Promise<StaffSession | null> {
  const row = await findStaffUserRowById(env, userId);
  if (!row) return null;
  return {
    row,
    user: rowToPublicUser(row),
    displayLabel: displayLabelForRow(row),
  };
}

export function parseSessionCookie(request: Request): string | null {
  const cookie = request.headers.get("Cookie");
  if (!cookie) return null;
  for (const part of cookie.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === SESSION_COOKIE) return rest.join("=");
  }
  return null;
}

export function sessionCookieHeader(
  token: string,
  maxAgeSec: number,
  secure = true,
  domain?: string
): string {
  const parts = [
    `${SESSION_COOKIE}=${token}`,
    "Path=/",
    "HttpOnly",
    // Lax blocks credentialed fetch from the web app (e.g. localhost / Vercel) to workers.dev.
    secure ? "SameSite=None" : "SameSite=Lax",
    `Max-Age=${maxAgeSec}`,
  ];
  if (secure) parts.push("Secure");
  // Share across kitchen.phiof.digital + api.kitchen.phiof.digital so the
  // same-origin /api/backend proxy can forward the session cookie.
  if (domain) parts.push(`Domain=${domain}`);
  return parts.join("; ");
}

export function clearSessionCookieHeader(
  secure = true,
  domain?: string
): string {
  const parts = [
    `${SESSION_COOKIE}=`,
    "Path=/",
    "HttpOnly",
    secure ? "SameSite=None" : "SameSite=Lax",
    "Max-Age=0",
  ];
  if (secure) parts.push("Secure");
  if (domain) parts.push(`Domain=${domain}`);
  return parts.join("; ");
}

/** Registrable Domain=.example.com from an https origin, else undefined. */
export function cookieDomainFromWebOrigin(webOrigin: string): string | undefined {
  try {
    const host = new URL(webOrigin).hostname;
    if (host === "localhost" || host === "127.0.0.1") return undefined;
    const parts = host.split(".");
    if (parts.length < 2) return undefined;
    return `.${parts.slice(-2).join(".")}`;
  } catch {
    return undefined;
  }
}
