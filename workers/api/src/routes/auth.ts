import { corsHeaders, jsonResponse } from "../cors";
import { logStaffActivity } from "../auth/activity";
import {
  canInviteRole,
  canManageTeam,
  inviteStaffMember,
  listTeamMembers,
  updateStaffProfile,
} from "../auth/staff";
import {
  canRequestMagicLink,
  clearSessionCookieHeader,
  consumeMagicLinkToken,
  createMagicLinkToken,
  createSession,
  deleteSession,
  getStaffSession,
  parseSessionCookie,
  resolveStaffUserOnLogin,
  sessionCookieHeader,
  SESSION_TTL_MS,
} from "../auth/session";
import { sendMagicLinkEmail } from "../email/magic-link";
import type { Env } from "../env";

function webOrigin(env: Env): string {
  const explicit = env.AUTH_WEB_ORIGIN?.trim();
  if (explicit) return explicit.replace(/\/$/, "");
  const first = (env.CORS_ORIGIN || "http://localhost:3000")
    .split(",")[0]
    ?.trim();
  return first ?? "http://localhost:3000";
}

function apiOrigin(request: Request): string {
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}`;
}

async function sendMagicLinkIfAllowed(
  request: Request,
  env: Env,
  email: string
): Promise<Response> {
  const allowed = await canRequestMagicLink(env, email);
  if (!allowed) {
    // Same response shape — do not reveal whether the email is registered.
    return jsonResponse(request, env, { ok: true });
  }

  const token = await createMagicLinkToken(env, email);
  const verifyUrl = `${apiOrigin(request)}/auth/verify?token=${encodeURIComponent(token)}`;
  const apiKey = env.RESEND_API_KEY?.trim();
  if (apiKey) {
    await sendMagicLinkEmail(env, email, verifyUrl);
    return jsonResponse(request, env, { ok: true });
  }

  const host = new URL(request.url).hostname;
  if (host === "localhost" || host === "127.0.0.1") {
    console.warn("Resend not configured — dev verify URL:", verifyUrl);
    return jsonResponse(request, env, { ok: true, devVerifyUrl: verifyUrl });
  }

  return jsonResponse(
    request,
    env,
    { error: "Email sign-in is not configured" },
    503
  );
}

export async function handleMagicLink(
  request: Request,
  env: Env
): Promise<Response> {
  let body: { email?: unknown };
  try {
    body = (await request.json()) as { email?: unknown };
  } catch {
    return jsonResponse(request, env, { error: "Invalid JSON" }, 400);
  }

  const email =
    typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!email || !email.includes("@")) {
    return jsonResponse(request, env, { error: "Valid email required" }, 400);
  }

  try {
    return await sendMagicLinkIfAllowed(request, env, email);
  } catch (e) {
    console.error("Magic link send failed", e);
    return jsonResponse(
      request,
      env,
      { error: "Could not send sign-in email" },
      500
    );
  }
}

export async function handleVerify(
  request: Request,
  env: Env
): Promise<Response> {
  const url = new URL(request.url);
  const rawToken = url.searchParams.get("token")?.trim();
  if (!rawToken) {
    return Response.redirect(`${webOrigin(env)}/login?error=missing_token`, 302);
  }

  const email = await consumeMagicLinkToken(env, rawToken);
  if (!email) {
    return Response.redirect(`${webOrigin(env)}/login?error=invalid_token`, 302);
  }

  const row = await resolveStaffUserOnLogin(env, email);
  if (!row) {
    return Response.redirect(`${webOrigin(env)}/login?error=not_invited`, 302);
  }

  const sessionToken = await createSession(env, row.id);
  const maxAgeSec = Math.floor(SESSION_TTL_MS / 1000);
  const secure = new URL(request.url).protocol === "https:";

  return new Response(null, {
    status: 302,
    headers: {
      Location: `${webOrigin(env)}/inbox`,
      "Set-Cookie": sessionCookieHeader(sessionToken, maxAgeSec, secure),
    },
  });
}

export async function handleLogout(
  request: Request,
  env: Env
): Promise<Response> {
  const raw = parseSessionCookie(request);
  if (raw) await deleteSession(env, raw);
  const secure = new URL(request.url).protocol === "https:";

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: corsHeaders(request, env, {
      "Content-Type": "application/json",
      "Set-Cookie": clearSessionCookieHeader(secure),
    }),
  });
}

export async function handleMe(
  request: Request,
  env: Env
): Promise<Response> {
  const session = await getStaffSession(env, request);
  if (!session) {
    return jsonResponse(request, env, { error: "Unauthorized" }, 401);
  }
  return jsonResponse(request, env, { user: session.user });
}

export async function handleUpdateProfile(
  request: Request,
  env: Env
): Promise<Response> {
  const session = await getStaffSession(env, request);
  if (!session) {
    return jsonResponse(request, env, { error: "Unauthorized" }, 401);
  }

  let body: { displayName?: unknown };
  try {
    body = (await request.json()) as { displayName?: unknown };
  } catch {
    return jsonResponse(request, env, { error: "Invalid JSON" }, 400);
  }

  const displayName =
    typeof body.displayName === "string" ? body.displayName.trim() : "";
  if (!displayName || displayName.length > 40) {
    return jsonResponse(
      request,
      env,
      { error: "Nickname is required (max 40 characters)" },
      400
    );
  }

  const updated = await updateStaffProfile(env, session.row.id, displayName);
  if (!updated) {
    return jsonResponse(request, env, { error: "Could not save profile" }, 500);
  }

  await logStaffActivity(
    env,
    session.row.id,
    displayName,
    "profile.updated",
    { metadata: { displayName } }
  );

  const nextSession = await getStaffSession(env, request);
  return jsonResponse(request, env, { user: nextSession!.user });
}

export async function handleListTeam(
  request: Request,
  env: Env
): Promise<Response> {
  const session = await getStaffSession(env, request);
  if (!session) {
    return jsonResponse(request, env, { error: "Unauthorized" }, 401);
  }
  if (!canManageTeam(session.row.role)) {
    return jsonResponse(request, env, { error: "Forbidden" }, 403);
  }

  const members = await listTeamMembers(env);
  return jsonResponse(request, env, { members });
}

export async function handleInviteTeam(
  request: Request,
  env: Env
): Promise<Response> {
  const session = await getStaffSession(env, request);
  if (!session) {
    return jsonResponse(request, env, { error: "Unauthorized" }, 401);
  }
  if (!canManageTeam(session.row.role)) {
    return jsonResponse(request, env, { error: "Forbidden" }, 403);
  }

  let body: { email?: unknown; role?: unknown };
  try {
    body = (await request.json()) as { email?: unknown; role?: unknown };
  } catch {
    return jsonResponse(request, env, { error: "Invalid JSON" }, 400);
  }

  const email =
    typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const role = body.role === "admin" ? "admin" : "member";

  if (!email || !email.includes("@")) {
    return jsonResponse(request, env, { error: "Valid email required" }, 400);
  }

  if (!canInviteRole(session.row.role, role)) {
    return jsonResponse(request, env, { error: "Forbidden" }, 403);
  }

  try {
    const member = await inviteStaffMember(
      env,
      email,
      role,
      session.row.id
    );

    await logStaffActivity(
      env,
      session.row.id,
      session.displayLabel,
      "team.invited",
      { metadata: { email, role } }
    );

    try {
      await sendMagicLinkIfAllowed(request, env, email);
    } catch (e) {
      console.error("Invite magic link send failed", e);
    }

    return jsonResponse(request, env, { member });
  } catch (e) {
    if (e instanceof Error && e.message === "already_exists") {
      return jsonResponse(request, env, { error: "User already exists" }, 409);
    }
    console.error("Team invite failed", e);
    return jsonResponse(request, env, { error: "Could not invite user" }, 500);
  }
}
