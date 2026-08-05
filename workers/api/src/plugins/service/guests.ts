import { canonicalPhone } from "../../db/phone-utils";
import type { Env } from "../../env";

/**
 * Guest → CRM contact adapter.
 *
 * The `contacts` / `contact_identifiers` tables belong to the CRM lineage
 * (migrations 0023-0033) and exist only on forks that applied it. This module
 * probes for them once per isolate and degrades to `null` when they are
 * absent, which is why `reservations.contact_id` carries no foreign key.
 *
 * It is the only writer of `contact_id`. It never creates a contact: linking a
 * reservation to an existing guest record is useful, but inventing CRM rows
 * from a booking form is the CRM's decision, not this module's.
 *
 * Every failure path returns `{ contactId: null }`. A reservation that is not
 * linked to a contact is a minor loss; a reservation that fails to save
 * because a lookup threw is a guest turned away at the door.
 */

export type GuestIdentity = {
  /** Kept for a stable signature. Identity is resolved by phone or email
   *  only — matching on a name would merge two different Sarah Joneses. */
  name: string;
  email?: string | null;
  phone?: string | null;
};

export type ResolvedGuest = { contactId: string | null };

/**
 * Cached as a Promise, not a boolean, so concurrent first requests in a cold
 * isolate share one probe instead of each firing their own.
 */
let contactsProbe: Promise<boolean> | null = null;

async function probeContacts(env: Env): Promise<boolean> {
  const { results } = await env.DB.prepare(
    `SELECT name FROM sqlite_master
     WHERE type = 'table' AND name IN ('contacts', 'contact_identifiers')`
  ).all<{ name: string }>();

  // Both are required: the identifiers table is the lookup index and the
  // contacts table is what makes a hit meaningful.
  return (results ?? []).length === 2;
}

async function contactsAvailable(env: Env): Promise<boolean> {
  if (!contactsProbe) {
    // A failed probe caches `false`: on a fork without the CRM this is the
    // permanent truth, and on one with it the next isolate retries.
    contactsProbe = probeContacts(env).catch(() => false);
  }
  return contactsProbe;
}

/**
 * Test-only. The probe result is deliberately process-wide, so a test that
 * creates or drops the CRM tables must clear it.
 */
export function resetContactsProbe(): void {
  contactsProbe = null;
}

/** Matches normalizeIdentifierValue() in the CRM plugin exactly. A lookup
 *  normalised differently from the write silently never matches. */
function normaliseIdentifier(type: "phone" | "email", raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  return type === "phone" ? canonicalPhone(trimmed) : trimmed.toLowerCase();
}

async function lookupByIdentifier(
  env: Env,
  type: "phone" | "email",
  raw: string | null | undefined
): Promise<string | null> {
  if (!raw) return null;
  const value = normaliseIdentifier(type, raw);
  if (!value) return null;

  const row = await env.DB.prepare(
    `SELECT ci.contact_id AS contact_id
     FROM contact_identifiers ci
     JOIN contacts c ON c.id = ci.contact_id
     WHERE ci.organization_id = ? AND ci.type = ? AND ci.value = ?
     LIMIT 1`
  )
    .bind(env.ORGANIZATION_ID, type, value)
    .first<{ contact_id: string }>();

  return row?.contact_id ?? null;
}

/**
 * Resolve a booking's guest details to a CRM contact id, or null.
 *
 * Phone is tried before email: a phone number identifies one person, whereas
 * a household or office email is routinely shared.
 */
export async function resolveGuest(
  env: Env,
  guest: GuestIdentity
): Promise<ResolvedGuest> {
  try {
    if (!(await contactsAvailable(env))) return { contactId: null };

    const byPhone = await lookupByIdentifier(env, "phone", guest.phone);
    if (byPhone) return { contactId: byPhone };

    const byEmail = await lookupByIdentifier(env, "email", guest.email);
    return { contactId: byEmail };
  } catch (err) {
    console.warn(
      `[${env.ORGANIZATION_ID}] guest contact lookup failed, continuing unlinked:`,
      err
    );
    return { contactId: null };
  }
}
