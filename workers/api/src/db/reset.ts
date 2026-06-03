import type { Env } from "../env";

export async function deleteAllLeadsAndData(env: Env): Promise<{
  leadsDeleted: number;
}> {
  const orgId = env.ORGANIZATION_ID;

  const countRow = await env.DB.prepare(
    `SELECT COUNT(*) as c FROM leads WHERE organization_id = ?`
  )
    .bind(orgId)
    .first<{ c: number }>();

  const leadsDeleted = countRow?.c ?? 0;

  // Child tables cascade from leads; clear org-level tables explicitly
  await env.DB.batch([
    env.DB.prepare(
      `DELETE FROM domain_events WHERE organization_id = ?`
    ).bind(orgId),
    env.DB.prepare(`DELETE FROM webhook_deliveries`),
    env.DB.prepare(`DELETE FROM leads WHERE organization_id = ?`).bind(orgId),
  ]);

  return { leadsDeleted };
}
