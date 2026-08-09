import type { Env } from "../../../env";
import { canonicalPhone } from "../../../db/phone-utils";

const ANON_NAME = "Former guest";
const ANON_EMAIL_MARKER = "anonymised@invalid.local";

export type AnonymiseResult = {
  reservations: number;
  waitlist: number;
  threads: number;
  messages: number;
  profiles: number;
  notifications: number;
  tokensRevoked: number;
  contacts: number;
};

/** Shared PII wipe used by retention cron and admin erase. */
export async function anonymiseGuestSurfaces(
  env: Env,
  opts: {
    reservationIds?: string[];
    contactIds?: string[];
    emails?: string[];
    phones?: string[];
    /** When set, only touch reservations with starts_at_utc before this ISO. */
    beforeUtc?: string;
    locationId?: string;
  }
): Promise<AnonymiseResult> {
  const org = env.ORGANIZATION_ID;
  const result: AnonymiseResult = {
    reservations: 0,
    waitlist: 0,
    threads: 0,
    messages: 0,
    profiles: 0,
    notifications: 0,
    tokensRevoked: 0,
    contacts: 0,
  };

  const reservationIds = new Set(opts.reservationIds ?? []);
  const contactIds = new Set(opts.contactIds ?? []);
  const emails = new Set(
    (opts.emails ?? []).map((e) => e.trim().toLowerCase()).filter(Boolean)
  );
  const phones = new Set(
    (opts.phones ?? []).map((p) => canonicalPhone(p)).filter(Boolean)
  );

  if (opts.beforeUtc) {
    let sql = `SELECT id, contact_id, guest_email, guest_phone FROM reservations
               WHERE organization_id = ? AND starts_at_utc < ?
                 AND (guest_name != ? OR guest_email IS NOT NULL OR guest_phone IS NOT NULL)`;
    const binds: unknown[] = [org, opts.beforeUtc, ANON_NAME];
    if (opts.locationId) {
      sql += ` AND location_id = ?`;
      binds.push(opts.locationId);
    }
    const { results } = await env.DB.prepare(sql)
      .bind(...binds)
      .all<{
        id: string;
        contact_id: string | null;
        guest_email: string | null;
        guest_phone: string | null;
      }>();
    for (const row of results ?? []) {
      reservationIds.add(row.id);
      if (row.contact_id) contactIds.add(row.contact_id);
      if (row.guest_email) emails.add(row.guest_email.toLowerCase());
      if (row.guest_phone) phones.add(canonicalPhone(row.guest_phone));
    }
  }

  // Expand contacts from email/phone identifiers.
  for (const email of emails) {
    const row = await env.DB.prepare(
      `SELECT c.id FROM contacts c
       JOIN contact_identifiers ci ON ci.contact_id = c.id
       WHERE c.organization_id = ? AND ci.type = 'email' AND lower(ci.value) = ?`
    )
      .bind(org, email)
      .first<{ id: string }>();
    if (row) contactIds.add(row.id);
  }
  for (const phone of phones) {
    const row = await env.DB.prepare(
      `SELECT c.id FROM contacts c
       JOIN contact_identifiers ci ON ci.contact_id = c.id
       WHERE c.organization_id = ? AND ci.type = 'phone' AND ci.value = ?`
    )
      .bind(org, phone)
      .first<{ id: string }>();
    if (row) contactIds.add(row.id);
  }

  // Reservations matching contact / email / phone.
  if (contactIds.size || emails.size || phones.size) {
    const { results } = await env.DB.prepare(
      `SELECT id, contact_id, guest_email, guest_phone FROM reservations
       WHERE organization_id = ?`
    )
      .bind(org)
      .all<{
        id: string;
        contact_id: string | null;
        guest_email: string | null;
        guest_phone: string | null;
      }>();
    for (const row of results ?? []) {
      const email = row.guest_email?.toLowerCase() ?? "";
      const phone = row.guest_phone ? canonicalPhone(row.guest_phone) : "";
      if (
        (row.contact_id && contactIds.has(row.contact_id)) ||
        (email && emails.has(email)) ||
        (phone && phones.has(phone))
      ) {
        reservationIds.add(row.id);
        if (row.contact_id) contactIds.add(row.contact_id);
        if (email) emails.add(email);
        if (phone) phones.add(phone);
      }
    }
  }

  for (const id of reservationIds) {
    const upd = await env.DB.prepare(
      `UPDATE reservations SET
         guest_name = ?, guest_phone = NULL, guest_email = NULL,
         contact_id = NULL, allergies = NULL, guest_notes = NULL,
         occasion = NULL, marketing_opt_in = 0, updated_at = datetime('now')
       WHERE id = ? AND organization_id = ?
         AND (guest_name != ? OR guest_email IS NOT NULL OR guest_phone IS NOT NULL
              OR allergies IS NOT NULL OR guest_notes IS NOT NULL)`
    )
      .bind(ANON_NAME, id, org, ANON_NAME)
      .run();
    result.reservations += upd.meta.changes ?? 0;

    const tok = await env.DB.prepare(
      `UPDATE guest_access_tokens SET revoked_at = datetime('now')
       WHERE reservation_id = ? AND organization_id = ? AND revoked_at IS NULL`
    )
      .bind(id, org)
      .run();
    result.tokensRevoked += tok.meta.changes ?? 0;
  }

  // Waitlist by contact / email / phone
  {
    const { results } = await env.DB.prepare(
      `SELECT id FROM waitlist_entries WHERE organization_id = ?`
    )
      .bind(org)
      .all<{ id: string }>();
    // Prefer targeted update
    if (contactIds.size || emails.size || phones.size) {
      const all = await env.DB.prepare(
        `SELECT id, contact_id, guest_email, guest_phone FROM waitlist_entries
         WHERE organization_id = ?`
      )
        .bind(org)
        .all<{
          id: string;
          contact_id: string | null;
          guest_email: string | null;
          guest_phone: string | null;
        }>();
      for (const row of all.results ?? []) {
        const email = row.guest_email?.toLowerCase() ?? "";
        const phone = row.guest_phone ? canonicalPhone(row.guest_phone) : "";
        if (
          (row.contact_id && contactIds.has(row.contact_id)) ||
          (email && emails.has(email)) ||
          (phone && phones.has(phone))
        ) {
          const u = await env.DB.prepare(
            `UPDATE waitlist_entries SET
               guest_name = ?, guest_phone = NULL, guest_email = NULL,
               contact_id = NULL, notes = NULL
             WHERE id = ? AND organization_id = ?`
          )
            .bind(ANON_NAME, row.id, org)
            .run();
          result.waitlist += u.meta.changes ?? 0;
        }
      }
    } else if (opts.beforeUtc && results) {
      // retention path already collected via reservations; also age out waitlist by joined_at
      const aged = await env.DB.prepare(
        `UPDATE waitlist_entries SET
           guest_name = ?, guest_phone = NULL, guest_email = NULL,
           contact_id = NULL, notes = NULL
         WHERE organization_id = ? AND joined_at < ?
           AND (guest_email IS NOT NULL OR guest_phone IS NOT NULL OR guest_name != ?)`
      )
        .bind(ANON_NAME, org, opts.beforeUtc, ANON_NAME)
        .run();
      result.waitlist += aged.meta.changes ?? 0;
    }
  }

  // Threads
  {
    const all = await env.DB.prepare(
      `SELECT id, reservation_id, guest_email, guest_phone FROM guest_threads
       WHERE organization_id = ?`
    )
      .bind(org)
      .all<{
        id: string;
        reservation_id: string | null;
        guest_email: string | null;
        guest_phone: string | null;
      }>();
    for (const row of all.results ?? []) {
      const email = row.guest_email?.toLowerCase() ?? "";
      const phone = row.guest_phone ? canonicalPhone(row.guest_phone) : "";
      const match =
        (row.reservation_id && reservationIds.has(row.reservation_id)) ||
        (email && emails.has(email)) ||
        (phone && phones.has(phone));
      if (!match && !opts.beforeUtc) continue;
      if (!match && opts.beforeUtc) {
        // retention: only wipe if already matched via reservation set
        continue;
      }
      if (!match) continue;
      const u = await env.DB.prepare(
        `UPDATE guest_threads SET
           guest_name = ?, guest_email = NULL, guest_phone = NULL,
           preview = NULL, updated_at = datetime('now')
         WHERE id = ? AND organization_id = ?`
      )
        .bind(ANON_NAME, row.id, org)
        .run();
      result.threads += u.meta.changes ?? 0;

      const m = await env.DB.prepare(
        `UPDATE guest_messages SET
           body = '[redacted]', subject = NULL, updated_at = datetime('now')
         WHERE thread_id = ? AND organization_id = ?
           AND body != '[redacted]'`
      )
        .bind(row.id, org)
        .run();
      result.messages += m.meta.changes ?? 0;
    }
  }

  // Notifications to_address
  for (const email of emails) {
    const u = await env.DB.prepare(
      `UPDATE notifications SET to_address = ?, payload_json = NULL, updated_at = datetime('now')
       WHERE organization_id = ? AND lower(to_address) = ? AND to_address != ?`
    )
      .bind(ANON_EMAIL_MARKER, org, email, ANON_EMAIL_MARKER)
      .run();
    result.notifications += u.meta.changes ?? 0;
  }
  for (const phone of phones) {
    const u = await env.DB.prepare(
      `UPDATE notifications SET to_address = ?, payload_json = NULL, updated_at = datetime('now')
       WHERE organization_id = ? AND to_address = ? AND to_address != ?`
    )
      .bind("anonymised", org, phone, "anonymised")
      .run();
    result.notifications += u.meta.changes ?? 0;
  }
  for (const id of reservationIds) {
    const u = await env.DB.prepare(
      `UPDATE notifications SET to_address = CASE
         WHEN channel = 'email' THEN ? ELSE 'anonymised' END,
         payload_json = NULL, updated_at = datetime('now')
       WHERE organization_id = ? AND reservation_id = ?
         AND to_address NOT IN (?, 'anonymised')`
    )
      .bind(ANON_EMAIL_MARKER, org, id, ANON_EMAIL_MARKER)
      .run();
    result.notifications += u.meta.changes ?? 0;
  }

  // Profiles + contacts
  for (const cid of contactIds) {
    const p = await env.DB.prepare(
      `UPDATE guest_profiles SET
         allergies = NULL, dietary = NULL, notes = NULL,
         seating_preference = NULL, marketing_opt_in = 0,
         marketing_opt_in_at = NULL, updated_at = datetime('now')
       WHERE contact_id = ? AND organization_id = ?`
    )
      .bind(cid, org)
      .run();
    result.profiles += p.meta.changes ?? 0;

    const c = await env.DB.prepare(
      `UPDATE contacts SET name = ?, phone_e164 = ?, email = NULL
       WHERE id = ? AND organization_id = ?`
    )
      .bind(ANON_NAME, `anon:${cid}`, cid, org)
      .run();
    result.contacts += c.meta.changes ?? 0;

    await env.DB.prepare(
      `DELETE FROM contact_identifiers WHERE contact_id = ? AND organization_id = ?`
    )
      .bind(cid, org)
      .run();
  }

  return result;
}

/** Cron: anonymise guests past each venue's retention window (default 24 months). */
export async function runRetentionAnonymisation(
  env: Env
): Promise<{ locations: number; result: AnonymiseResult }> {
  const { results: venues } = await env.DB.prepare(
    `SELECT location_id, COALESCE(retention_months, 24) AS retention_months
     FROM venue_settings WHERE organization_id = ?`
  )
    .bind(env.ORGANIZATION_ID)
    .all<{ location_id: string; retention_months: number }>();

  const merged: AnonymiseResult = {
    reservations: 0,
    waitlist: 0,
    threads: 0,
    messages: 0,
    profiles: 0,
    notifications: 0,
    tokensRevoked: 0,
    contacts: 0,
  };

  let locations = 0;
  for (const v of venues ?? []) {
    locations += 1;
    const months = Math.max(1, Number(v.retention_months) || 24);
    const before = new Date();
    before.setUTCMonth(before.getUTCMonth() - months);
    const beforeUtc = before.toISOString();
    const r = await anonymiseGuestSurfaces(env, {
      beforeUtc,
      locationId: v.location_id,
    });
    for (const k of Object.keys(merged) as (keyof AnonymiseResult)[]) {
      merged[k] += r[k];
    }
  }

  // Orgs with no venue_settings row yet: still honour default 24 months org-wide.
  if (locations === 0) {
    const before = new Date();
    before.setUTCMonth(before.getUTCMonth() - 24);
    const r = await anonymiseGuestSurfaces(env, {
      beforeUtc: before.toISOString(),
    });
    return { locations: 0, result: r };
  }

  return { locations, result: merged };
}

export { ANON_NAME, ANON_EMAIL_MARKER };
