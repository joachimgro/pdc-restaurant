import type { Env } from "../env";
import { jsonResponse } from "../cors";
import { requestMagicLink, verifyMagicLink } from "../auth/magic-link";
import { createSession, revokeSession } from "../auth/sessions";
import { requireAuth, extractBearerToken } from "../auth/middleware";

export async function handleMagicLinkRequest(
  request: Request,
  env: Env
): Promise<Response> {
  let body: { email?: unknown };
  try {
    body = (await request.json()) as { email?: unknown };
  } catch {
    return jsonResponse(request, env, { error: "Invalid JSON" }, 400);
  }

  if (typeof body.email !== "string" || !body.email.includes("@")) {
    return jsonResponse(request, env, { error: "Valid email required" }, 400);
  }

  const result = await requestMagicLink(env, body.email);

  if ("error" in result) {
    return jsonResponse(request, env, { error: result.error }, result.status);
  }

  return jsonResponse(request, env, { ok: true });
}

export async function handleMagicLinkVerify(
  request: Request,
  env: Env
): Promise<Response> {
  let body: { token?: unknown };
  try {
    body = (await request.json()) as { token?: unknown };
  } catch {
    return jsonResponse(request, env, { error: "Invalid JSON" }, 400);
  }

  if (typeof body.token !== "string" || body.token.length === 0) {
    return jsonResponse(request, env, { error: "Token required" }, 400);
  }

  const email = await verifyMagicLink(env, body.token);
  if (!email) {
    return jsonResponse(
      request,
      env,
      { error: "Invalid or expired sign-in link. Please request a new one." },
      401
    );
  }

  const sessionToken = await createSession(env.DB, email);

  return jsonResponse(request, env, {
    ok: true,
    token: sessionToken,
    email,
    expiresInDays: 7,
  });
}

export async function handleLogout(
  request: Request,
  env: Env
): Promise<Response> {
  // Best-effort revocation — even if the token is invalid we return 200
  const rawToken = extractBearerToken(request);
  if (rawToken) {
    await revokeSession(env.DB, rawToken);
  }
  return jsonResponse(request, env, { ok: true });
}

export async function handleMe(
  request: Request,
  env: Env
): Promise<Response> {
  const auth = await requireAuth(request, env);
  if (auth instanceof Response) return auth;
  return jsonResponse(request, env, { email: auth.email });
}
