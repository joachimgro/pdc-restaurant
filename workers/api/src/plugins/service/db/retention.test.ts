import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { Env } from "../../../env";
import { queryServiceStats } from "./stats";
import {
  ANON_NAME,
  runRetentionAnonymisation,
} from "./retention";
import {
  eraseGuestByEmailOrPhone,
  exportGuestByEmailOrPhone,
} from "./guest-privacy";

const e = () => env as unknown as Env;

async function seedFinishedGuest(opts: {
  email: string;
  phone: string;
  startsAtUtc: string;
  serviceDate: string;
}): Promise<{ reservationId: string; contactId: string }> {
  const contactId = crypto.randomUUID();
  const reservationId = crypto.randomUUID();
  const locationId = "loc-retention";
  const reference = `R${reservationId.slice(0, 8).toUpperCase()}`;

  await e()
    .DB.prepare(
      "INSERT OR IGNORE INTO organizations (id, name) VALUES (?, ?)"
    )
    .bind(e().ORGANIZATION_ID, "Test")
    .run();
  await e()
    .DB.prepare(
      `INSERT OR IGNORE INTO locations (id, organization_id, name, abbrev)
       VALUES (?, ?, ?, ?)`
    )
    .bind(locationId, e().ORGANIZATION_ID, "Venue", "V")
    .run();
  await e()
    .DB.prepare(
      `INSERT OR REPLACE INTO venue_settings (
         location_id, organization_id, timezone, retention_months
       ) VALUES (?, ?, 'Europe/London', 24)`
    )
    .bind(locationId, e().ORGANIZATION_ID)
    .run();

  await e()
    .DB.prepare(
      `INSERT INTO contacts (id, organization_id, name, phone_e164, email)
       VALUES (?, ?, ?, ?, ?)`
    )
    .bind(contactId, e().ORGANIZATION_ID, "Ada Lovelace", opts.phone, opts.email)
    .run();
  await e()
    .DB.prepare(
      `INSERT INTO contact_identifiers (id, contact_id, organization_id, type, value, is_primary)
       VALUES (?, ?, ?, 'email', ?, 1)`
    )
    .bind(crypto.randomUUID(), contactId, e().ORGANIZATION_ID, opts.email)
    .run();
  await e()
    .DB.prepare(
      `INSERT INTO contact_identifiers (id, contact_id, organization_id, type, value, is_primary)
       VALUES (?, ?, ?, 'phone', ?, 1)`
    )
    .bind(crypto.randomUUID(), contactId, e().ORGANIZATION_ID, opts.phone)
    .run();
  await e()
    .DB.prepare(
      `INSERT INTO guest_profiles (contact_id, organization_id, allergies, notes, visit_count, no_show_count)
       VALUES (?, ?, 'nuts', 'VIP notes', 3, 1)`
    )
    .bind(contactId, e().ORGANIZATION_ID)
    .run();

  await e()
    .DB.prepare(
      `INSERT INTO reservations (
         id, organization_id, location_id, reference, contact_id,
         guest_name, guest_phone, guest_email, party_size,
         service_date, start_time, end_time, starts_at_utc,
         status, source, assignment_locked, deposit_required_pence,
         marketing_opt_in, allergies, guest_notes
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 2, ?, '19:00', '20:30', ?,
                 'finished', 'online', 0, 0, 1, 'nuts', 'window seat')`
    )
    .bind(
      reservationId,
      e().ORGANIZATION_ID,
      locationId,
      reference,
      contactId,
      "Ada Lovelace",
      opts.phone,
      opts.email,
      opts.serviceDate,
      opts.startsAtUtc
    )
    .run();

  const threadId = crypto.randomUUID();
  await e()
    .DB.prepare(
      `INSERT INTO guest_threads (
         id, organization_id, location_id, reservation_id,
         guest_name, guest_email, guest_phone, preview
       ) VALUES (?, ?, ?, ?, ?, ?, ?, 'hello')`
    )
    .bind(
      threadId,
      e().ORGANIZATION_ID,
      locationId,
      reservationId,
      "Ada Lovelace",
      opts.email,
      opts.phone
    )
    .run();
  await e()
    .DB.prepare(
      `INSERT INTO guest_messages (
         id, thread_id, organization_id, direction, channel, body, status
       ) VALUES (?, ?, ?, 'inbound', 'email', 'Please confirm allergies', 'delivered')`
    )
    .bind(crypto.randomUUID(), threadId, e().ORGANIZATION_ID)
    .run();

  await e()
    .DB.prepare(
      `INSERT INTO notifications (
         id, organization_id, location_id, reservation_id, channel, template,
         to_address, status, scheduled_for, idempotency_key
       ) VALUES (?, ?, ?, ?, 'email', 'reminder', ?, 'scheduled', datetime('now'), ?)`
    )
    .bind(
      crypto.randomUUID(),
      e().ORGANIZATION_ID,
      locationId,
      reservationId,
      opts.email,
      `idem-${reservationId}`
    )
    .run();

  await e()
    .DB.prepare(
      `INSERT INTO guest_access_tokens (
         id, organization_id, reservation_id, token_hash, scope, expires_at
       ) VALUES (?, ?, ?, ?, 'manage', datetime('now', '+1 day'))`
    )
    .bind(
      crypto.randomUUID(),
      e().ORGANIZATION_ID,
      reservationId,
      `hash-${reservationId}`
    )
    .run();

  return { reservationId, contactId };
}

describe("retention anonymisation", () => {
  it("strips PII from aged bookings but keeps covers/no-show aggregates", async () => {
    const old = await seedFinishedGuest({
      email: "old@example.com",
      phone: "+447700900001",
      serviceDate: "2023-01-15",
      startsAtUtc: "2023-01-15T19:00:00.000Z",
    });
    const recent = await seedFinishedGuest({
      email: "new@example.com",
      phone: "+447700900002",
      serviceDate: "2026-07-01",
      startsAtUtc: "2026-07-01T18:00:00.000Z",
    });

    const beforeStats = await queryServiceStats(
      e(),
      "loc-retention",
      "2020-01-01",
      "2026-12-31"
    );
    expect(beforeStats.covers).toBeGreaterThanOrEqual(4);
    expect(beforeStats.finished).toBeGreaterThanOrEqual(2);

    await runRetentionAnonymisation(e());

    const oldRow = await e()
      .DB.prepare(`SELECT guest_name, guest_email, guest_phone, party_size, status FROM reservations WHERE id = ?`)
      .bind(old.reservationId)
      .first<{
        guest_name: string;
        guest_email: string | null;
        guest_phone: string | null;
        party_size: number;
        status: string;
      }>();
    expect(oldRow?.guest_name).toBe(ANON_NAME);
    expect(oldRow?.guest_email).toBeNull();
    expect(oldRow?.guest_phone).toBeNull();
    expect(oldRow?.party_size).toBe(2);
    expect(oldRow?.status).toBe("finished");

    const recentRow = await e()
      .DB.prepare(`SELECT guest_email FROM reservations WHERE id = ?`)
      .bind(recent.reservationId)
      .first<{ guest_email: string | null }>();
    expect(recentRow?.guest_email).toBe("new@example.com");

    const afterStats = await queryServiceStats(
      e(),
      "loc-retention",
      "2020-01-01",
      "2026-12-31"
    );
    expect(afterStats.covers).toBe(beforeStats.covers);
    expect(afterStats.finished).toBe(beforeStats.finished);
    expect(afterStats.noShows).toBe(beforeStats.noShows);
  });
});

describe("erase + export guest", () => {
  it("seeds across surfaces, erases all PII, and export is empty of live PII", async () => {
    const email = "erase-me@example.com";
    const phone = "+447700900777";
    const { reservationId, contactId } = await seedFinishedGuest({
      email,
      phone,
      serviceDate: "2026-06-01",
      startsAtUtc: "2026-06-01T18:00:00.000Z",
    });

    const exported = await exportGuestByEmailOrPhone(e(), { email });
    expect(exported.reservations.length).toBeGreaterThan(0);
    expect(exported.contacts.length).toBeGreaterThan(0);
    expect(exported.messages.length).toBeGreaterThan(0);

    await eraseGuestByEmailOrPhone(e(), { email });

    const res = await e()
      .DB.prepare(
        `SELECT guest_name, guest_email, guest_phone, allergies FROM reservations WHERE id = ?`
      )
      .bind(reservationId)
      .first<{
        guest_name: string;
        guest_email: string | null;
        guest_phone: string | null;
        allergies: string | null;
      }>();
    expect(res?.guest_name).toBe(ANON_NAME);
    expect(res?.guest_email).toBeNull();
    expect(res?.guest_phone).toBeNull();
    expect(res?.allergies).toBeNull();

    const profile = await e()
      .DB.prepare(
        `SELECT allergies, notes FROM guest_profiles WHERE contact_id = ?`
      )
      .bind(contactId)
      .first<{ allergies: string | null; notes: string | null }>();
    expect(profile?.allergies).toBeNull();
    expect(profile?.notes).toBeNull();

    const tokens = await e()
      .DB.prepare(
        `SELECT COUNT(*) AS n FROM guest_access_tokens
         WHERE reservation_id = ? AND revoked_at IS NULL`
      )
      .bind(reservationId)
      .first<{ n: number }>();
    expect(Number(tokens?.n)).toBe(0);

    const ids = await e()
      .DB.prepare(
        `SELECT COUNT(*) AS n FROM contact_identifiers WHERE contact_id = ?`
      )
      .bind(contactId)
      .first<{ n: number }>();
    expect(Number(ids?.n)).toBe(0);

    const notif = await e()
      .DB.prepare(
        `SELECT to_address FROM notifications WHERE reservation_id = ?`
      )
      .bind(reservationId)
      .first<{ to_address: string }>();
    expect(notif?.to_address).not.toBe(email);
  });
});
