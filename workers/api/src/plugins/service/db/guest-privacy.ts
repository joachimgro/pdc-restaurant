import type { Env } from "../../../env";
import { canonicalPhone } from "../../../db/phone-utils";
import {
  anonymiseGuestSurfaces,
  ANON_NAME,
} from "./retention";

export type GuestExport = {
  exportedAt: string;
  contacts: unknown[];
  identifiers: unknown[];
  profiles: unknown[];
  reservations: unknown[];
  waitlist: unknown[];
  threads: unknown[];
  messages: unknown[];
  notifications: unknown[];
};

async function resolveContactIds(
  env: Env,
  opts: { email?: string; phone?: string }
): Promise<{ contactIds: string[]; emails: string[]; phones: string[] }> {
  const org = env.ORGANIZATION_ID;
  const emails: string[] = [];
  const phones: string[] = [];
  const contactIds = new Set<string>();

  if (opts.email?.trim()) {
    const email = opts.email.trim().toLowerCase();
    emails.push(email);
    const byId = await env.DB.prepare(
      `SELECT contact_id AS id FROM contact_identifiers
       WHERE organization_id = ? AND type = 'email' AND lower(value) = ?`
    )
      .bind(org, email)
      .first<{ id: string }>();
    if (byId) contactIds.add(byId.id);
    const byContact = await env.DB.prepare(
      `SELECT id FROM contacts WHERE organization_id = ? AND lower(email) = ?`
    )
      .bind(org, email)
      .first<{ id: string }>();
    if (byContact) contactIds.add(byContact.id);
  }

  if (opts.phone?.trim()) {
    const phone = canonicalPhone(opts.phone);
    phones.push(phone);
    const byId = await env.DB.prepare(
      `SELECT contact_id AS id FROM contact_identifiers
       WHERE organization_id = ? AND type = 'phone' AND value = ?`
    )
      .bind(org, phone)
      .first<{ id: string }>();
    if (byId) contactIds.add(byId.id);
    const byContact = await env.DB.prepare(
      `SELECT id FROM contacts WHERE organization_id = ? AND phone_e164 = ?`
    )
      .bind(org, phone)
      .first<{ id: string }>();
    if (byContact) contactIds.add(byContact.id);
  }

  return { contactIds: [...contactIds], emails, phones };
}

export async function eraseGuestByEmailOrPhone(
  env: Env,
  opts: { email?: string; phone?: string }
): Promise<Awaited<ReturnType<typeof anonymiseGuestSurfaces>>> {
  if (!opts.email?.trim() && !opts.phone?.trim()) {
    throw new Error("email or phone required");
  }
  const resolved = await resolveContactIds(env, opts);
  return anonymiseGuestSurfaces(env, {
    contactIds: resolved.contactIds,
    emails: resolved.emails,
    phones: resolved.phones,
  });
}

export async function exportGuestByEmailOrPhone(
  env: Env,
  opts: { email?: string; phone?: string }
): Promise<GuestExport> {
  if (!opts.email?.trim() && !opts.phone?.trim()) {
    throw new Error("email or phone required");
  }
  const org = env.ORGANIZATION_ID;
  const resolved = await resolveContactIds(env, opts);
  const emails = new Set(resolved.emails);
  const phones = new Set(resolved.phones);
  const contactIds = new Set(resolved.contactIds);

  const contacts: unknown[] = [];
  for (const id of contactIds) {
    const row = await env.DB.prepare(
      `SELECT * FROM contacts WHERE id = ? AND organization_id = ?`
    )
      .bind(id, org)
      .first();
    if (row) contacts.push(row);
  }

  const identifiers: unknown[] = [];
  for (const id of contactIds) {
    const { results } = await env.DB.prepare(
      `SELECT * FROM contact_identifiers WHERE contact_id = ? AND organization_id = ?`
    )
      .bind(id, org)
      .all();
    identifiers.push(...(results ?? []));
  }

  const profiles: unknown[] = [];
  for (const id of contactIds) {
    const row = await env.DB.prepare(
      `SELECT * FROM guest_profiles WHERE contact_id = ? AND organization_id = ?`
    )
      .bind(id, org)
      .first();
    if (row) profiles.push(row);
  }

  const { results: allRes } = await env.DB.prepare(
    `SELECT * FROM reservations WHERE organization_id = ?`
  )
    .bind(org)
    .all<Record<string, unknown>>();
  const reservations = (allRes ?? []).filter((r) => {
    const email = String(r.guest_email ?? "").toLowerCase();
    const phone = r.guest_phone ? canonicalPhone(String(r.guest_phone)) : "";
    return (
      (r.contact_id && contactIds.has(String(r.contact_id))) ||
      (email && emails.has(email)) ||
      (phone && phones.has(phone))
    );
  });

  const { results: allWait } = await env.DB.prepare(
    `SELECT * FROM waitlist_entries WHERE organization_id = ?`
  )
    .bind(org)
    .all<Record<string, unknown>>();
  const waitlist = (allWait ?? []).filter((r) => {
    const email = String(r.guest_email ?? "").toLowerCase();
    const phone = r.guest_phone ? canonicalPhone(String(r.guest_phone)) : "";
    return (
      (r.contact_id && contactIds.has(String(r.contact_id))) ||
      (email && emails.has(email)) ||
      (phone && phones.has(phone))
    );
  });

  const { results: allThreads } = await env.DB.prepare(
    `SELECT * FROM guest_threads WHERE organization_id = ?`
  )
    .bind(org)
    .all<Record<string, unknown>>();
  const threads = (allThreads ?? []).filter((t) => {
    const email = String(t.guest_email ?? "").toLowerCase();
    const phone = t.guest_phone ? canonicalPhone(String(t.guest_phone)) : "";
    const resId = t.reservation_id ? String(t.reservation_id) : "";
    return (
      (email && emails.has(email)) ||
      (phone && phones.has(phone)) ||
      reservations.some((r) => String(r.id) === resId)
    );
  });

  const messages: unknown[] = [];
  for (const t of threads) {
    const { results } = await env.DB.prepare(
      `SELECT * FROM guest_messages WHERE thread_id = ? AND organization_id = ?`
    )
      .bind(String(t.id), org)
      .all();
    messages.push(...(results ?? []));
  }

  const notifications: unknown[] = [];
  for (const email of emails) {
    const { results } = await env.DB.prepare(
      `SELECT * FROM notifications WHERE organization_id = ? AND lower(to_address) = ?`
    )
      .bind(org, email)
      .all();
    notifications.push(...(results ?? []));
  }
  for (const phone of phones) {
    const { results } = await env.DB.prepare(
      `SELECT * FROM notifications WHERE organization_id = ? AND to_address = ?`
    )
      .bind(org, phone)
      .all();
    notifications.push(...(results ?? []));
  }
  for (const r of reservations) {
    const { results } = await env.DB.prepare(
      `SELECT * FROM notifications WHERE organization_id = ? AND reservation_id = ?`
    )
      .bind(org, String(r.id))
      .all();
    notifications.push(...(results ?? []));
  }

  return {
    exportedAt: new Date().toISOString(),
    contacts,
    identifiers,
    profiles,
    reservations,
    waitlist,
    threads,
    messages,
    notifications,
  };
}

export { ANON_NAME };
