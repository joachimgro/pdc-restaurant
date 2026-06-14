import type { Env } from "../env";

export type OrgLocation = {
  id: string;
  name: string;
  abbrev: string;
};

/** First location for this org (oldest by created_at), or null if none configured. */
export async function getDefaultLocation(
  env: Env
): Promise<OrgLocation | null> {
  return env.DB.prepare(
    `SELECT id, name, abbrev FROM locations
     WHERE organization_id = ?
     ORDER BY created_at ASC
     LIMIT 1`
  )
    .bind(env.ORGANIZATION_ID)
    .first<OrgLocation>();
}

export async function getOrgLocations(env: Env): Promise<OrgLocation[]> {
  const { results } = await env.DB.prepare(
    `SELECT id, name, abbrev FROM locations
     WHERE organization_id = ?
     ORDER BY name ASC`
  )
    .bind(env.ORGANIZATION_ID)
    .all<OrgLocation>();

  return results ?? [];
}

export async function countOrgLocations(env: Env): Promise<number> {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM locations WHERE organization_id = ?`
  )
    .bind(env.ORGANIZATION_ID)
    .first<{ n: number }>();

  return row?.n ?? 0;
}

export async function getLocationNameById(
  env: Env,
  locationId: string
): Promise<string> {
  const row = await env.DB.prepare(
    `SELECT name FROM locations WHERE id = ? AND organization_id = ?`
  )
    .bind(locationId, env.ORGANIZATION_ID)
    .first<{ name: string }>();

  return row?.name ?? locationId;
}

/** Match lead text against configured org locations (id, display name, abbrev). */
export async function resolveLocationIdFromText(
  env: Env,
  text: string
): Promise<string | undefined> {
  const locations = await getOrgLocations(env);
  const lower = text.toLowerCase();

  for (const loc of locations) {
    if (lower.includes(loc.id.toLowerCase())) return loc.id;
    if (lower.includes(loc.name.toLowerCase())) return loc.id;
    if (loc.abbrev && lower.includes(loc.abbrev.toLowerCase())) return loc.id;
  }

  return undefined;
}
