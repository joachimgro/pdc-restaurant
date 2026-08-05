import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import worker from "../index";
import { hashToken, SESSION_COOKIE } from "../auth/crypto";
import type { Env } from "../env";

/**
 * The HTTP-level rerun of the concurrency test: 20 parallel
 * POST /service/reservations at one slot with one suitable table, asserting a
 * literal one 201 and nineteen 409 SLOT_TAKEN.
 *
 * holds-concurrency.test.ts proves the mechanism; this proves the whole route
 * around it — availability, hold, insert, consume — collapses to the same one
 * winner, and that nothing partial survives a loss.
 */

const LOCATION_ID = "venue-1";
const CONCURRENCY = 20;
const ITERATIONS = 20;

async function seedStaff(): Promise<string> {
  const token = `token-${crypto.randomUUID()}`;
  await env.DB.batch([
    env.DB.prepare(
      `INSERT OR IGNORE INTO staff_users (id, organization_id, email, name, role, status)
       VALUES ('staff-race', ?, 'race@example.com', 'Race Staff', 'member', 'active')`
    ).bind(env.ORGANIZATION_ID),
    env.DB.prepare(
      `INSERT INTO staff_sessions (id, user_id, token_hash, expires_at)
       VALUES (?, 'staff-race', ?, ?)`
    ).bind(
      crypto.randomUUID(),
      await hashToken(token),
      new Date(Date.now() + 3_600_000).toISOString()
    ),
  ]);
  return token;
}

/** One table only — the whole point of the race. */
async function seedSingleTableVenue(): Promise<void> {
  await env.DB.batch([
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
         cancellation_window_hours)
       VALUES (?, ?, 'Europe/London', 'race-venue', 15, 90, 30, 1, 8, 0, 3650, 600, 1, 1, 24)`
    ).bind(LOCATION_ID, env.ORGANIZATION_ID),
    env.DB.prepare(
      `INSERT OR IGNORE INTO rooms (id, organization_id, location_id, name,
         accent_color, online_bookable, canvas_width, canvas_height, sort_order, is_active)
       VALUES ('room-1', ?, ?, 'Main', NULL, 1, 1200, 800, 0, 1)`
    ).bind(env.ORGANIZATION_ID, LOCATION_ID),
    env.DB.prepare(
      `INSERT OR IGNORE INTO dining_tables (id, organization_id, location_id, room_id,
         label, seats_min, seats_max, shape, pos_x, pos_y, width, height, rotation,
         online_bookable, assign_priority, is_active, notes)
       VALUES ('tbl-only', ?, ?, 'room-1', '1', 2, 4, 'square', 0, 0, 100, 100, 0, 1, 100, 1, NULL)`
    ).bind(env.ORGANIZATION_ID, LOCATION_ID),
    // Friday and Saturday, so iterations can alternate dates.
    env.DB.prepare(
      `INSERT OR IGNORE INTO service_periods (id, organization_id, location_id, name,
         day_of_week, start_time, end_time, last_seating_time, slot_interval_min,
         online_bookable, sort_order, is_active)
       VALUES ('period-fri', ?, ?, 'Dinner', 'fri', '18:00', '22:00', '21:00', NULL, 1, 0, 1)`
    ).bind(env.ORGANIZATION_ID, LOCATION_ID),
    env.DB.prepare(
      `INSERT OR IGNORE INTO service_periods (id, organization_id, location_id, name,
         day_of_week, start_time, end_time, last_seating_time, slot_interval_min,
         online_bookable, sort_order, is_active)
       VALUES ('period-sat', ?, ?, 'Dinner', 'sat', '18:00', '22:00', '21:00', NULL, 1, 0, 1)`
    ).bind(env.ORGANIZATION_ID, LOCATION_ID),
  ]);
}

function call(path: string, init: RequestInit & { token?: string } = {}) {
  const { token, ...rest } = init;
  const headers = new Headers(rest.headers);
  headers.set("Content-Type", "application/json");
  if (token) headers.set("Cookie", `${SESSION_COOKIE}=${token}`);
  // The test env provides DB and KV but no AI_QUEUE — these routes never
  // enqueue, so the missing binding is unreachable from them.
  return worker.fetch(
    new Request(`https://api.test${path}`, { ...rest, headers }),
    env as unknown as Env
  );
}

async function countRows(sql: string, ...binds: unknown[]): Promise<number> {
  const row = await env.DB.prepare(sql)
    .bind(...binds)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/** Alternating Fridays and Saturdays in September 2026. */
const DATES = [
  "2026-09-04", "2026-09-05", "2026-09-11", "2026-09-12",
  "2026-09-18", "2026-09-19", "2026-09-25", "2026-09-26",
  "2026-10-02", "2026-10-03", "2026-10-09", "2026-10-10",
  "2026-10-16", "2026-10-17", "2026-10-23", "2026-10-24",
  "2026-11-06", "2026-11-07", "2026-11-13", "2026-11-14",
];

let token = "";

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM reservation_hold_tables`),
    env.DB.prepare(`DELETE FROM reservation_holds`),
    env.DB.prepare(`DELETE FROM reservation_tables`),
    env.DB.prepare(`DELETE FROM reservation_events`),
    env.DB.prepare(`DELETE FROM reservations`),
  ]);
  await seedSingleTableVenue();
  token = await seedStaff();
});

describe("20 parallel POST /service/reservations at one slot", () => {
  it(
    `yields exactly one 201 and ${CONCURRENCY - 1} × 409 SLOT_TAKEN, ${ITERATIONS} iterations`,
    { timeout: 120_000 },
    async () => {
      for (let iteration = 0; iteration < ITERATIONS; iteration++) {
        const serviceDate = DATES[iteration];

        const responses = await Promise.all(
          Array.from({ length: CONCURRENCY }, (_, i) =>
            call("/service/reservations", {
              method: "POST",
              token,
              body: JSON.stringify({
                guestName: `Racer ${i}`,
                guestPhone: `+44770090${String(i).padStart(4, "0")}`,
                partySize: 2,
                serviceDate,
                startTime: "19:00",
              }),
            })
          )
        );

        const statuses = responses.map((r) => r.status);
        const created = statuses.filter((s) => s === 201);
        const conflicts = statuses.filter((s) => s === 409);

        expect(created, `iteration ${iteration}: 201s`).toHaveLength(1);
        expect(conflicts, `iteration ${iteration}: 409s`).toHaveLength(
          CONCURRENCY - 1
        );
        // No 500s hiding among the failures.
        expect(
          statuses.every((s) => s === 201 || s === 409),
          `iteration ${iteration}: statuses ${statuses.join(",")}`
        ).toBe(true);

        // Every loser explains itself and offers a way forward.
        const bodies = await Promise.all(
          responses
            .filter((r) => r.status === 409)
            .map((r) => r.json() as Promise<{ code: string; details: unknown }>)
        );
        expect(bodies.every((b) => b.code === "SLOT_TAKEN")).toBe(true);
        expect(bodies.every((b) => b.details !== undefined)).toBe(true);

        // The database is the real assertion: one reservation, one table row.
        expect(
          await countRows(
            `SELECT COUNT(*) AS n FROM reservations WHERE service_date = ?`,
            serviceDate
          ),
          `iteration ${iteration}: reservation rows`
        ).toBe(1);
        expect(
          await countRows(
            `SELECT COUNT(*) AS n FROM reservation_tables rt
             JOIN reservations r ON r.id = rt.reservation_id
             WHERE r.service_date = ?`,
            serviceDate
          ),
          `iteration ${iteration}: table rows`
        ).toBe(1);

        // And no live hold is stranded behind the winner.
        expect(
          await countRows(
            `SELECT COUNT(*) AS n FROM reservation_holds
             WHERE service_date = ? AND consumed_at IS NULL`,
            serviceDate
          ),
          `iteration ${iteration}: stranded holds`
        ).toBe(0);
      }
    }
  );
});
