import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { Env } from "../env";
import { createEntry, listForDate } from "../plugins/service/db/waitlist";

const LOCATION_ID = "venue-waitlist";

async function seedVenue(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS contacts (
         id TEXT PRIMARY KEY,
         organization_id TEXT NOT NULL,
         name TEXT
       )`
    ),
    env.DB.prepare(
      `INSERT OR IGNORE INTO organizations (id, name) VALUES (?, 'Test Org')`
    ).bind(env.ORGANIZATION_ID),
    env.DB.prepare(
      `INSERT OR IGNORE INTO locations (id, organization_id, name, abbrev)
       VALUES (?, ?, 'Test Venue', 'TV')`
    ).bind(LOCATION_ID, env.ORGANIZATION_ID),
    env.DB.prepare(
      `INSERT OR REPLACE INTO venue_settings (location_id, organization_id, timezone,
         booking_slug, slot_interval_min, default_turn_minutes, grace_after_close_min,
         min_party_online, max_party_online, min_lead_minutes, max_advance_days,
         hold_ttl_seconds, auto_assign_tables, allow_online_waitlist,
         cancellation_window_hours, brand_json)
       VALUES (?, ?, 'Europe/London', 'test-venue', 15, 90, 30, 1, 8, 0, 365, 600, 1, 1, 24,
               '{"name":"Test Kitchen"}')`
    ).bind(LOCATION_ID, env.ORGANIZATION_ID),
  ]);
}

describe("waitlist db", () => {
  it("createEntry + listForDate returns computed position", async () => {
    await seedVenue();
    const serviceDate = `2026-10-${String(Math.floor(Math.random() * 28) + 1).padStart(2, "0")}`;

    const entry = await createEntry(env as unknown as Env, {
      locationId: LOCATION_ID,
      guestName: "Jamie Queue",
      partySize: 4,
      kind: "walk_in",
      serviceDate,
      guestPhone: "+441234567890",
    });

    expect(entry.guest_name).toBe("Jamie Queue");
    expect(entry.status).toBe("waiting");

    const queue = await listForDate(
      env as unknown as Env,
      LOCATION_ID,
      serviceDate
    );
    expect(queue.length).toBeGreaterThanOrEqual(1);
    const found = queue.find((e) => e.id === entry.id);
    expect(found?.position).toBeGreaterThanOrEqual(1);
  });
});
