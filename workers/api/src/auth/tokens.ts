/** Generate a cryptographically random 32-byte hex token. */
export function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** SHA-256 hash of a token, returned as a hex string. */
export async function hashToken(raw: string): Promise<string> {
  const data = new TextEncoder().encode(raw);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** ISO-8601 timestamp N minutes from now. */
export function nowPlusMinutes(n: number): string {
  return new Date(Date.now() + n * 60 * 1000).toISOString();
}

/** ISO-8601 timestamp N days from now. */
export function nowPlusDays(n: number): string {
  return new Date(Date.now() + n * 24 * 60 * 60 * 1000).toISOString();
}

/** True if the given ISO-8601 timestamp is in the past. */
export function isExpired(expiresAt: string): boolean {
  return new Date(expiresAt) < new Date();
}
