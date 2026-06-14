import type { Env } from "../env";

export type StaffActivityAction =
  | "note.added"
  | "message.sent"
  | "lead.takeover"
  | "lead.resume_ai"
  | "team.invited"
  | "profile.updated";

export async function logStaffActivity(
  env: Env,
  staffUserId: string,
  staffDisplayName: string,
  action: StaffActivityAction,
  opts?: { leadId?: string; metadata?: Record<string, unknown> }
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO staff_activity_log
     (id, organization_id, staff_user_id, staff_display_name, action, lead_id, metadata_json)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      crypto.randomUUID(),
      env.ORGANIZATION_ID,
      staffUserId,
      staffDisplayName,
      action,
      opts?.leadId ?? null,
      opts?.metadata ? JSON.stringify(opts.metadata) : null
    )
    .run();
}
