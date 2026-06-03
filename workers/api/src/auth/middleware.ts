import type { Env } from "../env";
import { jsonResponse } from "../cors";
import { validateSession } from "./sessions";

export interface AuthContext {
  email: string;
}

/**
 * Extract and validate the Bearer session token from the request.
 *
 * Returns { email } on success.
 * Returns a 401 Response on failure — the caller should return it immediately.
 *
 * Usage in index.ts:
 *   const auth = await requireAuth(request, env);
 *   if (auth instanceof Response) return auth;
 *   // auth.email is now available
 */
export async function requireAuth(
  request: Request,
  env: Env
): Promise<AuthContext | Response> {
  const token = extractBearerToken(request) ?? extractQueryToken(request);

  if (!token) {
    return jsonResponse(request, env, { error: "Unauthorized" }, 401);
  }

  const session = await validateSession(env.DB, token);
  if (!session) {
    return jsonResponse(request, env, { error: "Unauthorized" }, 401);
  }

  return { email: session.email };
}

/** Extract the raw token from `Authorization: Bearer <token>` */
export function extractBearerToken(request: Request): string | null {
  const header = request.headers.get("Authorization") ?? "";
  if (!header.startsWith("Bearer ")) return null;
  const token = header.slice(7).trim();
  return token.length > 0 ? token : null;
}

/** Extract the raw token from `?token=<token>` query param (used for SSE). */
function extractQueryToken(request: Request): string | null {
  const url = new URL(request.url);
  const token = url.searchParams.get("token")?.trim() ?? null;
  return token && token.length > 0 ? token : null;
}
