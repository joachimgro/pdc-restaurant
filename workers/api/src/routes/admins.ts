import type { Env } from "../env";
import { jsonResponse } from "../cors";

const SUPER_ADMIN_DEFAULT = "justphiof@gmail.com";

interface AdminRow {
  email: string;
  added_by: string | null;
  created_at: string;
}

export async function handleListAdmins(
  request: Request,
  env: Env
): Promise<Response> {
  const { results } = await env.DB.prepare(
    `SELECT email, added_by, created_at FROM admins ORDER BY created_at ASC`
  ).all<AdminRow>();

  return jsonResponse(request, env, { admins: results ?? [] });
}

export async function handleAddAdmin(
  request: Request,
  env: Env,
  addedBy: string
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

  const email = body.email.toLowerCase().trim();

  // Check if already an admin
  const existing = await env.DB.prepare(
    `SELECT email FROM admins WHERE email = ?`
  )
    .bind(email)
    .first<{ email: string }>();

  if (existing) {
    return jsonResponse(
      request,
      env,
      { error: "This email is already an admin" },
      409
    );
  }

  await env.DB.prepare(
    `INSERT INTO admins (email, added_by) VALUES (?, ?)`
  )
    .bind(email, addedBy)
    .run();

  return jsonResponse(request, env, { ok: true, email });
}

export async function handleRemoveAdmin(
  request: Request,
  env: Env,
  targetEmail: string
): Promise<Response> {
  const superAdmin = (env.SUPER_ADMIN_EMAIL ?? SUPER_ADMIN_DEFAULT).toLowerCase().trim();

  if (targetEmail.toLowerCase() === superAdmin) {
    return jsonResponse(
      request,
      env,
      { error: "The super admin cannot be removed" },
      403
    );
  }

  const existing = await env.DB.prepare(
    `SELECT email FROM admins WHERE email = ?`
  )
    .bind(targetEmail.toLowerCase())
    .first<{ email: string }>();

  if (!existing) {
    return jsonResponse(request, env, { error: "Admin not found" }, 404);
  }

  await env.DB.prepare(`DELETE FROM admins WHERE email = ?`)
    .bind(targetEmail.toLowerCase())
    .run();

  return jsonResponse(request, env, { ok: true });
}
