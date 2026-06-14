/** SHA-256 hex digest for token storage (never store raw tokens). */
export async function hashToken(token: string): Promise<string> {
  const data = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function randomToken(): string {
  return crypto.randomUUID() + crypto.randomUUID();
}

export const SESSION_COOKIE = "lead_intake_session";
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
export const MAGIC_LINK_TTL_MS = 15 * 60 * 1000; // 15 minutes
