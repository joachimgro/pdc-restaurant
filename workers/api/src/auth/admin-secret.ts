import type { Env } from "../env";

/** Operator scripts may pass X-Admin-Secret when ADMIN_SEED_SECRET is configured. */
export function adminSecretAuthorized(request: Request, env: Env): boolean {
  const secret = env.ADMIN_SEED_SECRET;
  if (!secret) return false;
  return request.headers.get("X-Admin-Secret") === secret;
}
