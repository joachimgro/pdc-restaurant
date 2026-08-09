import type { GuestProfile, ReliabilityChip } from "@lead-intake/shared-types";
import type { Env } from "../../../env";
import { toBool } from "../types";

export type GuestProfileRow = {
  contact_id: string;
  organization_id: string;
  vip: number;
  allergies: string | null;
  dietary: string | null;
  seating_preference: string | null;
  notes: string | null;
  visit_count: number;
  no_show_count: number;
  cancel_count: number;
  lifetime_covers: number;
  reliability_score: number;
  last_visit_at: string | null;
  first_visit_at: string | null;
  marketing_opt_in: number;
  marketing_opt_in_at: string | null;
  blocked: number;
  blocked_reason: string | null;
  updated_at: string;
};

/** Good >= 80, Watch >= 50, Risk < 50. */
export function reliabilityChip(score: number): ReliabilityChip {
  if (score >= 80) return "good";
  if (score >= 50) return "watch";
  return "risk";
}

function rowToProfile(row: GuestProfileRow): GuestProfile {
  return {
    contactId: row.contact_id,
    vip: toBool(row.vip),
    allergies: row.allergies,
    dietary: row.dietary,
    seatingPreference: row.seating_preference,
    notes: row.notes,
    visitCount: row.visit_count,
    noShowCount: row.no_show_count,
    cancelCount: row.cancel_count,
    lifetimeCovers: row.lifetime_covers,
    reliabilityScore: row.reliability_score,
    reliabilityChip: reliabilityChip(row.reliability_score),
    lastVisitAt: row.last_visit_at,
    firstVisitAt: row.first_visit_at,
    marketingOptIn: toBool(row.marketing_opt_in),
    marketingOptInAt: row.marketing_opt_in_at,
    blocked: toBool(row.blocked),
    blockedReason: row.blocked_reason,
    updatedAt: row.updated_at,
  };
}

export async function getGuestProfile(
  env: Env,
  contactId: string
): Promise<GuestProfile | null> {
  const row = await env.DB.prepare(
    `SELECT * FROM guest_profiles
     WHERE contact_id = ? AND organization_id = ?`
  )
    .bind(contactId, env.ORGANIZATION_ID)
    .first<GuestProfileRow>();
  return row ? rowToProfile(row) : null;
}

/**
 * Ensure a profile row exists for a known contact. Never creates contacts
 * or leads — caller must already have a contact id from resolveGuest.
 */
export async function getOrCreateProfile(
  env: Env,
  contactId: string
): Promise<GuestProfile | null> {
  const existing = await getGuestProfile(env, contactId);
  if (existing) return existing;

  const contact = await env.DB.prepare(
    `SELECT id FROM contacts WHERE id = ? AND organization_id = ?`
  )
    .bind(contactId, env.ORGANIZATION_ID)
    .first<{ id: string }>();
  if (!contact) return null;

  await env.DB.prepare(
    `INSERT INTO guest_profiles (contact_id, organization_id)
     VALUES (?, ?)
     ON CONFLICT(contact_id) DO NOTHING`
  )
    .bind(contactId, env.ORGANIZATION_ID)
    .run();

  return getGuestProfile(env, contactId);
}

function computeReliabilityScore(
  visitCount: number,
  noShowCount: number,
  cancelCount: number
): number {
  const total = visitCount + noShowCount + cancelCount;
  if (total === 0) return 100;
  return Math.max(0, Math.min(100, Math.round((100 * visitCount) / total)));
}

/**
 * Recompute visit counters from reservations. Heals after status corrections.
 */
export async function recalcGuestProfile(
  env: Env,
  contactId: string
): Promise<GuestProfile | null> {
  const contact = await env.DB.prepare(
    `SELECT id FROM contacts WHERE id = ? AND organization_id = ?`
  )
    .bind(contactId, env.ORGANIZATION_ID)
    .first<{ id: string }>();
  if (!contact) return null;

  const stats = await env.DB.prepare(
    `SELECT
       SUM(CASE WHEN status = 'finished' THEN 1 ELSE 0 END) AS visit_count,
       SUM(CASE WHEN status = 'no_show' THEN 1 ELSE 0 END) AS no_show_count,
       SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) AS cancel_count,
       SUM(CASE WHEN status = 'finished' THEN party_size ELSE 0 END) AS lifetime_covers,
       MAX(CASE WHEN status = 'finished' THEN finished_at END) AS last_visit_at,
       MIN(CASE WHEN status = 'finished' THEN finished_at END) AS first_visit_at
     FROM reservations
     WHERE organization_id = ? AND contact_id = ?`
  )
    .bind(env.ORGANIZATION_ID, contactId)
    .first<{
      visit_count: number | null;
      no_show_count: number | null;
      cancel_count: number | null;
      lifetime_covers: number | null;
      last_visit_at: string | null;
      first_visit_at: string | null;
    }>();

  const visitCount = stats?.visit_count ?? 0;
  const noShowCount = stats?.no_show_count ?? 0;
  const cancelCount = stats?.cancel_count ?? 0;
  const lifetimeCovers = stats?.lifetime_covers ?? 0;
  const reliabilityScore = computeReliabilityScore(
    visitCount,
    noShowCount,
    cancelCount
  );

  await env.DB.prepare(
    `INSERT INTO guest_profiles (
       contact_id, organization_id, visit_count, no_show_count, cancel_count,
       lifetime_covers, reliability_score, last_visit_at, first_visit_at,
       updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(contact_id) DO UPDATE SET
       visit_count = excluded.visit_count,
       no_show_count = excluded.no_show_count,
       cancel_count = excluded.cancel_count,
       lifetime_covers = excluded.lifetime_covers,
       reliability_score = excluded.reliability_score,
       last_visit_at = excluded.last_visit_at,
       first_visit_at = excluded.first_visit_at,
       updated_at = datetime('now')`
  )
    .bind(
      contactId,
      env.ORGANIZATION_ID,
      visitCount,
      noShowCount,
      cancelCount,
      lifetimeCovers,
      reliabilityScore,
      stats?.last_visit_at ?? null,
      stats?.first_visit_at ?? null
    )
    .run();

  return getGuestProfile(env, contactId);
}

export async function setVip(
  env: Env,
  contactId: string,
  vip: boolean
): Promise<GuestProfile | null> {
  await getOrCreateProfile(env, contactId);
  await env.DB.prepare(
    `UPDATE guest_profiles
     SET vip = ?, updated_at = datetime('now')
     WHERE contact_id = ? AND organization_id = ?`
  )
    .bind(vip ? 1 : 0, contactId, env.ORGANIZATION_ID)
    .run();
  return getGuestProfile(env, contactId);
}

export async function patchGuestProfile(
  env: Env,
  contactId: string,
  patch: {
    vip?: boolean;
    allergies?: string | null;
    dietary?: string | null;
    seatingPreference?: string | null;
    notes?: string | null;
    blocked?: boolean;
    blockedReason?: string | null;
  }
): Promise<GuestProfile | null> {
  await getOrCreateProfile(env, contactId);

  const sets: string[] = [];
  const binds: unknown[] = [];

  if (patch.vip !== undefined) {
    sets.push("vip = ?");
    binds.push(patch.vip ? 1 : 0);
  }
  if (patch.allergies !== undefined) {
    sets.push("allergies = ?");
    binds.push(patch.allergies);
  }
  if (patch.dietary !== undefined) {
    sets.push("dietary = ?");
    binds.push(patch.dietary);
  }
  if (patch.seatingPreference !== undefined) {
    sets.push("seating_preference = ?");
    binds.push(patch.seatingPreference);
  }
  if (patch.notes !== undefined) {
    sets.push("notes = ?");
    binds.push(patch.notes);
  }
  if (patch.blocked !== undefined) {
    sets.push("blocked = ?");
    binds.push(patch.blocked ? 1 : 0);
  }
  if (patch.blockedReason !== undefined) {
    sets.push("blocked_reason = ?");
    binds.push(patch.blockedReason);
  }

  if (sets.length === 0) return getGuestProfile(env, contactId);

  sets.push("updated_at = datetime('now')");
  binds.push(contactId, env.ORGANIZATION_ID);

  await env.DB.prepare(
    `UPDATE guest_profiles SET ${sets.join(", ")}
     WHERE contact_id = ? AND organization_id = ?`
  )
    .bind(...binds)
    .run();

  return getGuestProfile(env, contactId);
}

export async function findContactIdByEmail(
  env: Env,
  email: string
): Promise<string | null> {
  const normalised = email.trim().toLowerCase();
  if (!normalised) return null;

  const row = await env.DB.prepare(
    `SELECT ci.contact_id AS contact_id
     FROM contact_identifiers ci
     JOIN contacts c ON c.id = ci.contact_id
     WHERE ci.organization_id = ? AND ci.type = 'email' AND ci.value = ?
     LIMIT 1`
  )
    .bind(env.ORGANIZATION_ID, normalised)
    .first<{ contact_id: string }>();

  return row?.contact_id ?? null;
}
