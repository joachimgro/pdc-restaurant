import type { StaffTeamMember } from "@lead-intake/shared-types";
import type { Env } from "../env";
import {
  isSuperadminEmail,
  publicTeamRole,
  type StaffRole,
} from "./constants";

export type StaffUserRow = {
  id: string;
  organization_id: string;
  email: string;
  name: string;
  role: StaffRole;
  display_name: string | null;
  profile_complete: number;
  invited_by: string | null;
  status: "invited" | "active";
};

function nameFromEmail(email: string): string {
  const local = email.split("@")[0] ?? "Team";
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ");
}

export function displayLabelForRow(row: StaffUserRow): string {
  return row.display_name?.trim() || row.name;
}

export function needsProfile(row: StaffUserRow): boolean {
  return row.profile_complete === 0 || !row.display_name?.trim();
}

export async function findStaffUserRow(
  env: Env,
  email: string
): Promise<StaffUserRow | null> {
  const normalized = email.trim().toLowerCase();
  return env.DB.prepare(
    `SELECT id, organization_id, email, name, role, display_name,
            profile_complete, invited_by, status
     FROM staff_users
     WHERE organization_id = ? AND email = ?`
  )
    .bind(env.ORGANIZATION_ID, normalized)
    .first<StaffUserRow>();
}

export async function findStaffUserRowById(
  env: Env,
  id: string
): Promise<StaffUserRow | null> {
  return env.DB.prepare(
    `SELECT id, organization_id, email, name, role, display_name,
            profile_complete, invited_by, status
     FROM staff_users
     WHERE organization_id = ? AND id = ?`
  )
    .bind(env.ORGANIZATION_ID, id)
    .first<StaffUserRow>();
}

export async function canRequestMagicLink(
  env: Env,
  email: string
): Promise<boolean> {
  const normalized = email.trim().toLowerCase();
  if (isSuperadminEmail(normalized)) return true;
  const row = await findStaffUserRow(env, normalized);
  return row != null && (row.status === "invited" || row.status === "active");
}

export async function resolveStaffUserOnLogin(
  env: Env,
  email: string
): Promise<StaffUserRow | null> {
  const normalized = email.trim().toLowerCase();

  if (isSuperadminEmail(normalized)) {
    const existing = await findStaffUserRow(env, normalized);
    if (existing) {
      if (existing.role !== "superadmin") {
        await env.DB.prepare(
          `UPDATE staff_users SET role = 'superadmin', status = 'active' WHERE id = ?`
        )
          .bind(existing.id)
          .run();
        return { ...existing, role: "superadmin", status: "active" };
      }
      return existing;
    }

    const id = crypto.randomUUID();
    const name = nameFromEmail(normalized);
    await env.DB.prepare(
      `INSERT INTO staff_users
       (id, organization_id, email, name, role, status, profile_complete)
       VALUES (?, ?, ?, ?, 'superadmin', 'active', 0)`
    )
      .bind(id, env.ORGANIZATION_ID, normalized, name)
      .run();

    return {
      id,
      organization_id: env.ORGANIZATION_ID,
      email: normalized,
      name,
      role: "superadmin",
      display_name: null,
      profile_complete: 0,
      invited_by: null,
      status: "active",
    };
  }

  const row = await findStaffUserRow(env, normalized);
  if (!row || row.status === "invited") {
    if (row?.status === "invited") {
      await env.DB.prepare(
        `UPDATE staff_users SET status = 'active' WHERE id = ?`
      )
        .bind(row.id)
        .run();
      return { ...row, status: "active" };
    }
    return null;
  }

  if (row.status !== "active") return null;
  return row;
}

export async function updateStaffProfile(
  env: Env,
  userId: string,
  displayName: string
): Promise<StaffUserRow | null> {
  const trimmed = displayName.trim();
  if (!trimmed) return null;

  await env.DB.prepare(
    `UPDATE staff_users
     SET display_name = ?, profile_complete = 1
     WHERE id = ? AND organization_id = ?`
  )
    .bind(trimmed, userId, env.ORGANIZATION_ID)
    .run();

  return findStaffUserRowById(env, userId);
}

export async function listTeamMembers(env: Env): Promise<StaffTeamMember[]> {
  const { results } = await env.DB.prepare(
    `SELECT id, email, name, role, display_name, status
     FROM staff_users
     WHERE organization_id = ?
     ORDER BY created_at ASC`
  )
    .bind(env.ORGANIZATION_ID)
    .all<{
      id: string;
      email: string;
      name: string;
      role: StaffRole;
      display_name: string | null;
      status: "invited" | "active";
    }>();

  return (results ?? []).map((r) => ({
    id: r.id,
    email: r.email,
    name: r.display_name?.trim() || r.name,
    displayName: r.display_name ?? undefined,
    role: publicTeamRole(r.role),
    status: r.status,
  }));
}

export async function inviteStaffMember(
  env: Env,
  email: string,
  role: "admin" | "member",
  invitedById: string
): Promise<StaffTeamMember> {
  const normalized = email.trim().toLowerCase();
  const existing = await findStaffUserRow(env, normalized);
  if (existing) {
    throw new Error("already_exists");
  }

  const id = crypto.randomUUID();
  const name = nameFromEmail(normalized);
  await env.DB.prepare(
    `INSERT INTO staff_users
     (id, organization_id, email, name, role, status, invited_by, profile_complete)
     VALUES (?, ?, ?, ?, ?, 'invited', ?, 0)`
  )
    .bind(id, env.ORGANIZATION_ID, normalized, name, role, invitedById)
    .run();

  return {
    id,
    email: normalized,
    name,
    role,
    status: "invited",
  };
}

export function canManageTeam(role: StaffRole): boolean {
  return role === "superadmin" || role === "admin";
}

export function canInviteRole(
  actorRole: StaffRole,
  targetRole: "admin" | "member"
): boolean {
  if (actorRole === "superadmin") return true;
  if (actorRole === "admin") return targetRole === "member";
  return false;
}

export function canAssignAdmins(role: StaffRole): boolean {
  return role === "superadmin";
}
