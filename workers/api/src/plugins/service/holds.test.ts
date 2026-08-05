import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import type { Env } from "../../env";
import { consumeHold, createHold, holdTableIds } from "./holds";

const testEnv = env as unknown as Env;

const LOCATION_ID = "venue-1";
const DATE = "2026-09-04";

let nextId = 0;
const id = (prefix: string) => `${prefix}-${++nextId}`;

async function seedVenue(tableIds: string[] = ["tbl-1"]): Promise<void> {
  const statements = [
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
  ];

  for (const tableId of tableIds) {
    statements.push(
      env.DB.prepare(
        `INSERT OR IGNORE INTO dining_tables (id, organization_id, location_id, room_id,
           label, seats_min, seats_max, shape, pos_x, pos_y, width, height, rotation,
           online_bookable, assign_priority, is_active, notes)
         VALUES (?, ?, ?, 'room-1', ?, 2, 4, 'square', 0, 0, 100, 100, 0, 1, 100, 1, NULL)`
      ).bind(tableId, env.ORGANIZATION_ID, LOCATION_ID, tableId)
    );
  }

  await env.DB.batch(statements);
}

async function seedReservation(opts: {
  tableIds: string[];
  startTime: string;
  endTime: string;
  status?: string;
  serviceDate?: string;
}): Promise<string> {
  const reservationId = id("res");
  const statements = [
    env.DB.prepare(
      `INSERT INTO reservations (id, organization_id, location_id, reference,
         guest_name, party_size, service_date, start_time, end_time,
         starts_at_utc, status, source)
       VALUES (?, ?, ?, ?, 'Existing Guest', 2, ?, ?, ?, ?, ?, 'staff')`
    ).bind(
      reservationId,
      env.ORGANIZATION_ID,
      LOCATION_ID,
      id("REF"),
      opts.serviceDate ?? DATE,
      opts.startTime,
      opts.endTime,
      `${opts.serviceDate ?? DATE}T18:00:00Z`,
      opts.status ?? "confirmed"
    ),
    ...opts.tableIds.map((tableId) =>
      env.DB.prepare(
        `INSERT INTO reservation_tables (reservation_id, table_id) VALUES (?, ?)`
      ).bind(reservationId, tableId)
    ),
  ];
  await env.DB.batch(statements);
  return reservationId;
}

function hold(overrides: Partial<Parameters<typeof createHold>[1]> = {}) {
  return createHold(testEnv, {
    holdId: id("hold"),
    locationId: LOCATION_ID,
    serviceDate: DATE,
    startTime: "19:00",
    endTime: "20:30",
    partySize: 2,
    clientTokenHash: id("tok"),
    ttlSeconds: 600,
    tableIds: ["tbl-1"],
    ...overrides,
  });
}

async function count(sql: string, ...binds: unknown[]): Promise<number> {
  const row = await env.DB.prepare(sql)
    .bind(...binds)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

beforeEach(async () => {
  // Storage accumulates across tests in a file, and a live hold from one
  // test silently turns the next test's expected success into SLOT_TAKEN.
  // Start every test from an empty book.
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM reservation_hold_tables`),
    env.DB.prepare(`DELETE FROM reservation_holds`),
    env.DB.prepare(`DELETE FROM reservation_tables`),
    env.DB.prepare(`DELETE FROM reservation_events`),
    env.DB.prepare(`DELETE FROM reservations`),
  ]);
  await seedVenue(["tbl-1", "tbl-2"]);
});

describe("createHold", () => {
  it("takes the hold on a free table and writes its member rows", async () => {
    const result = await hold({ holdId: "hold-free" });
    expect(result).toEqual({ ok: true, holdId: "hold-free" });

    expect(
      await count(
        `SELECT COUNT(*) AS n FROM reservation_holds WHERE id = 'hold-free'
           AND consumed_at IS NULL AND expires_at > datetime('now')`
      )
    ).toBe(1);
    expect(await holdTableIds(testEnv, "hold-free")).toEqual(["tbl-1"]);
  });

  it("rejects when a confirmed reservation overlaps the start of the window", async () => {
    // Existing 18:00–19:30; new 19:00–20:30 starts inside it.
    await seedReservation({ tableIds: ["tbl-1"], startTime: "18:00", endTime: "19:30" });
    expect(await hold()).toEqual({ ok: false, code: "SLOT_TAKEN" });
  });

  it("rejects when a confirmed reservation overlaps the end of the window", async () => {
    // Existing 20:00–21:30; new 19:00–20:30 ends inside it.
    await seedReservation({ tableIds: ["tbl-1"], startTime: "20:00", endTime: "21:30" });
    expect(await hold()).toEqual({ ok: false, code: "SLOT_TAKEN" });
  });

  it("allows adjacency: existing booking ends exactly when the hold starts", async () => {
    // The party leaving at 19:00 frees the table for a 19:00 booking.
    await seedReservation({ tableIds: ["tbl-1"], startTime: "17:30", endTime: "19:00" });
    expect((await hold()).ok).toBe(true);
  });

  it("allows adjacency: existing booking starts exactly when the hold ends", async () => {
    await seedReservation({ tableIds: ["tbl-1"], startTime: "20:30", endTime: "22:00" });
    expect((await hold()).ok).toBe(true);
  });

  it("one minute inside the boundary conflicts, in both directions", async () => {
    await seedReservation({ tableIds: ["tbl-1"], startTime: "17:30", endTime: "19:01" });
    expect(await hold()).toEqual({ ok: false, code: "SLOT_TAKEN" });

    await seedReservation({
      tableIds: ["tbl-2"],
      startTime: "20:29",
      endTime: "22:00",
    });
    expect(await hold({ tableIds: ["tbl-2"] })).toEqual({
      ok: false,
      code: "SLOT_TAKEN",
    });
  });

  it("ignores a reservation in a non-occupying status", async () => {
    await seedReservation({
      tableIds: ["tbl-1"],
      startTime: "19:00",
      endTime: "20:30",
      status: "cancelled",
    });
    expect((await hold()).ok).toBe(true);
  });

  it("rejects while a live hold overlaps, in both directions", async () => {
    expect((await hold({ startTime: "18:30", endTime: "20:00" })).ok).toBe(true);

    // New starts inside the live hold's window…
    expect(await hold({ startTime: "19:30", endTime: "21:00" })).toEqual({
      ok: false,
      code: "SLOT_TAKEN",
    });
    // …and new ends inside it.
    expect(await hold({ startTime: "18:00", endTime: "19:00" })).toEqual({
      ok: false,
      code: "SLOT_TAKEN",
    });
  });

  it("allows holds adjacent to a live hold in both directions", async () => {
    expect((await hold({ startTime: "19:00", endTime: "20:30" })).ok).toBe(true);
    expect((await hold({ startTime: "20:30", endTime: "21:30" })).ok).toBe(true);
    expect((await hold({ startTime: "18:00", endTime: "19:00" })).ok).toBe(true);
  });

  it("an expired hold does not block", async () => {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO reservation_holds (id, organization_id, location_id, service_date,
           start_time, end_time, party_size, client_token_hash, expires_at)
         VALUES ('hold-expired', ?, ?, ?, '19:00', '20:30', 2, 'tok-x',
                 datetime('now', '-60 seconds'))`
      ).bind(env.ORGANIZATION_ID, LOCATION_ID, DATE),
      env.DB.prepare(
        `INSERT INTO reservation_hold_tables (hold_id, table_id) VALUES ('hold-expired', 'tbl-1')`
      ),
    ]);

    expect((await hold()).ok).toBe(true);
  });

  it("a consumed hold does not block", async () => {
    const first = await hold({ holdId: "hold-consumed" });
    expect(first.ok).toBe(true);

    const reservationId = await seedReservation({
      // The reservation this hold became sits on a different window so only
      // the hold's own footprint is under test.
      tableIds: ["tbl-2"],
      startTime: "12:00",
      endTime: "13:30",
    });
    expect(await consumeHold(testEnv, "hold-consumed", reservationId)).toBe(true);

    expect((await hold()).ok).toBe(true);
  });

  it("a lost race writes nothing at all — no hold row, no member rows", async () => {
    expect((await hold({ holdId: "hold-winner" })).ok).toBe(true);
    expect(await hold({ holdId: "hold-loser" })).toEqual({
      ok: false,
      code: "SLOT_TAKEN",
    });

    expect(
      await count(
        `SELECT COUNT(*) AS n FROM reservation_holds WHERE id = 'hold-loser'`
      )
    ).toBe(0);
    expect(
      await count(
        `SELECT COUNT(*) AS n FROM reservation_hold_tables WHERE hold_id = 'hold-loser'`
      )
    ).toBe(0);
  });

  it("a multi-table hold is rejected when any one member conflicts", async () => {
    await seedReservation({ tableIds: ["tbl-2"], startTime: "19:00", endTime: "20:30" });

    expect(await hold({ tableIds: ["tbl-1", "tbl-2"] })).toEqual({
      ok: false,
      code: "SLOT_TAKEN",
    });
    // And the free member was not taken hostage by the failed attempt.
    expect(
      await count(
        `SELECT COUNT(*) AS n FROM reservation_hold_tables ht
         JOIN reservation_holds h ON h.id = ht.hold_id
         WHERE ht.table_id = 'tbl-1' AND h.consumed_at IS NULL`
      )
    ).toBe(0);
  });

  it("a multi-table hold takes every member when all are free", async () => {
    const result = await hold({
      holdId: "hold-combo",
      tableIds: ["tbl-1", "tbl-2"],
    });
    expect(result.ok).toBe(true);
    expect(await holdTableIds(testEnv, "hold-combo")).toEqual(["tbl-1", "tbl-2"]);
  });

  it("holds on different tables in the same window do not interfere", async () => {
    expect((await hold({ tableIds: ["tbl-1"] })).ok).toBe(true);
    expect((await hold({ tableIds: ["tbl-2"] })).ok).toBe(true);
  });

  it("rejects a zero or negative TTL before touching the database", async () => {
    await expect(hold({ ttlSeconds: 0 })).rejects.toThrow(/Invalid hold TTL/);
    await expect(hold({ ttlSeconds: -5 })).rejects.toThrow(/Invalid hold TTL/);
  });
});

describe("consumeHold", () => {
  it("consumes a live hold exactly once", async () => {
    await hold({ holdId: "hold-once" });
    const reservationId = await seedReservation({
      tableIds: ["tbl-2"],
      startTime: "12:00",
      endTime: "13:30",
    });

    expect(await consumeHold(testEnv, "hold-once", reservationId)).toBe(true);
    // Second consume: already consumed, must refuse.
    expect(await consumeHold(testEnv, "hold-once", reservationId)).toBe(false);

    const row = await env.DB.prepare(
      `SELECT reservation_id, consumed_at FROM reservation_holds WHERE id = 'hold-once'`
    ).first<{ reservation_id: string; consumed_at: string }>();
    expect(row?.reservation_id).toBe(reservationId);
    expect(row?.consumed_at).toBeTruthy();
  });

  it("refuses to consume an expired hold", async () => {
    await env.DB.prepare(
      `INSERT INTO reservation_holds (id, organization_id, location_id, service_date,
         start_time, end_time, party_size, client_token_hash, expires_at)
       VALUES ('hold-stale', ?, ?, ?, '19:00', '20:30', 2, 'tok-y',
               datetime('now', '-1 seconds'))`
    )
      .bind(env.ORGANIZATION_ID, LOCATION_ID, DATE)
      .run();

    expect(await consumeHold(testEnv, "hold-stale", "res-any")).toBe(false);
  });

  it("refuses to consume a hold that does not exist", async () => {
    expect(await consumeHold(testEnv, "hold-ghost", "res-any")).toBe(false);
  });
});
