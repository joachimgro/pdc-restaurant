import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import type { Env } from "../../env";
import { createHold, type CreateHoldResult } from "./holds";

/**
 * The phase's most important test (spec §18): two guests must never book the
 * same table for overlapping times.
 *
 * One slot, one suitable table, 20 concurrent reserve attempts. Exactly one
 * may win — and the database row counts are the real assertion, because a
 * polite error message with a duplicated hold row behind it is still a
 * double-booked table on Saturday night.
 *
 * The race re-runs across 20 iterations per suite run. A race that passes
 * once has told you nothing.
 *
 * Scope note: this exercises the mechanism at module level. The HTTP-level
 * rerun (one 201, nineteen 409 SLOT_TAKEN through POST /service/reservations)
 * lands with the routes in step 6. Also honest: the harness is one Miniflare
 * instance, so this proves the conditional insert cannot be split by
 * concurrent callers — production D1 serialises every write through the same
 * single primary, which is what carries the property across isolates.
 */

const testEnv = env as unknown as Env;

const LOCATION_ID = "venue-1";
const CONCURRENCY = 20;
const ITERATIONS = 20;

async function seedVenue(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(
      `INSERT OR IGNORE INTO organizations (id, name) VALUES (?, 'Test Org')`
    ).bind(env.ORGANIZATION_ID),
    env.DB.prepare(
      `INSERT OR IGNORE INTO locations (id, organization_id, name, abbrev)
       VALUES (?, ?, 'Test Venue', 'TV')`
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
  ]);
}

async function count(sql: string, ...binds: unknown[]): Promise<number> {
  const row = await env.DB.prepare(sql)
    .bind(...binds)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/** A distinct service date per iteration keeps every race independent. */
function dateForIteration(i: number): string {
  const day = String(i + 1).padStart(2, "0");
  return `2026-10-${day}`;
}

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM reservation_hold_tables`),
    env.DB.prepare(`DELETE FROM reservation_holds`),
  ]);
  await seedVenue();
});

describe("20-way concurrent reserve on one table", () => {
  it(
    `admits exactly one winner, ${ITERATIONS} iterations`,
    { timeout: 60_000 },
    async () => {
      for (let iteration = 0; iteration < ITERATIONS; iteration++) {
        const serviceDate = dateForIteration(iteration);

        const attempts: Promise<CreateHoldResult>[] = Array.from(
          { length: CONCURRENCY },
          (_, i) =>
            createHold(testEnv, {
              holdId: `hold-i${iteration}-c${i}`,
              locationId: LOCATION_ID,
              serviceDate,
              startTime: "19:00",
              endTime: "20:30",
              partySize: 2,
              clientTokenHash: `tok-i${iteration}-c${i}`,
              ttlSeconds: 600,
              tableIds: ["tbl-only"],
            })
        );

        const results = await Promise.all(attempts);

        const winners = results.filter((r) => r.ok);
        const losers = results.filter(
          (r): r is { ok: false; code: "SLOT_TAKEN" } => !r.ok
        );

        // Exactly one success, nineteen SLOT_TAKEN.
        expect(winners, `iteration ${iteration}: winners`).toHaveLength(1);
        expect(losers, `iteration ${iteration}: losers`).toHaveLength(
          CONCURRENCY - 1
        );
        expect(losers.every((l) => l.code === "SLOT_TAKEN")).toBe(true);

        // The assertions that matter more than the status codes: the database
        // holds exactly one hold row and exactly one member row for this race.
        const holdRows = await count(
          `SELECT COUNT(*) AS n FROM reservation_holds
           WHERE location_id = ? AND service_date = ?`,
          LOCATION_ID,
          serviceDate
        );
        const memberRows = await count(
          `SELECT COUNT(*) AS n FROM reservation_hold_tables ht
           JOIN reservation_holds h ON h.id = ht.hold_id
           WHERE h.location_id = ? AND h.service_date = ?`,
          LOCATION_ID,
          serviceDate
        );
        expect(holdRows, `iteration ${iteration}: hold rows`).toBe(1);
        expect(memberRows, `iteration ${iteration}: member rows`).toBe(1);

        // And the row that exists belongs to the caller that was told it won.
        const winner = winners[0] as { ok: true; holdId: string };
        const winnerRows = await count(
          `SELECT COUNT(*) AS n FROM reservation_holds
           WHERE id = ? AND service_date = ?`,
          winner.holdId,
          serviceDate
        );
        expect(winnerRows, `iteration ${iteration}: winner's row`).toBe(1);
      }
    }
  );

  it(
    "admits exactly one winner per table when two tables race independently",
    { timeout: 30_000 },
    async () => {
      await env.DB.prepare(
        `INSERT OR IGNORE INTO dining_tables (id, organization_id, location_id, room_id,
           label, seats_min, seats_max, shape, pos_x, pos_y, width, height, rotation,
           online_bookable, assign_priority, is_active, notes)
         VALUES ('tbl-second', ?, ?, 'room-1', '2', 2, 4, 'square', 200, 0, 100, 100, 0, 1, 100, 1, NULL)`
      )
        .bind(env.ORGANIZATION_ID, LOCATION_ID)
        .run();

      // Interleaved attempts across two tables in one Promise.all: the lock
      // on one table must not leak onto the other.
      const results = await Promise.all(
        Array.from({ length: CONCURRENCY }, (_, i) =>
          createHold(testEnv, {
            holdId: `hold-two-${i}`,
            locationId: LOCATION_ID,
            serviceDate: "2026-11-01",
            startTime: "19:00",
            endTime: "20:30",
            partySize: 2,
            clientTokenHash: `tok-two-${i}`,
            ttlSeconds: 600,
            tableIds: [i % 2 === 0 ? "tbl-only" : "tbl-second"],
          })
        )
      );

      expect(results.filter((r) => r.ok)).toHaveLength(2);
      expect(
        await count(
          `SELECT COUNT(*) AS n FROM reservation_holds WHERE service_date = '2026-11-01'`
        )
      ).toBe(2);
    }
  );
});
