import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import worker from "../index";
import { hashToken, SESSION_COOKIE } from "../auth/crypto";
import type { Env } from "../env";

const LOCATION_ID = "venue-1";
/** 2026-09-04 is a Friday. */
const DATE = "2026-09-04";

async function seedStaff(): Promise<string> {
  const token = `token-${crypto.randomUUID()}`;
  await env.DB.batch([
    env.DB.prepare(
      `INSERT OR IGNORE INTO staff_users (id, organization_id, email, name, role, status)
       VALUES ('staff-res', ?, 'res@example.com', 'Res Staff', 'member', 'active')`
    ).bind(env.ORGANIZATION_ID),
    env.DB.prepare(
      `INSERT INTO staff_sessions (id, user_id, token_hash, expires_at)
       VALUES (?, 'staff-res', ?, ?)`
    ).bind(
      crypto.randomUUID(),
      await hashToken(token),
      new Date(Date.now() + 3_600_000).toISOString()
    ),
  ]);
  return token;
}

function call(
  path: string,
  init: RequestInit & { token?: string } = {}
): Promise<Response> {
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

async function seedVenue(tableCount = 3): Promise<void> {
  const statements = [
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
       VALUES (?, ?, 'Europe/London', 'test-venue', 15, 90, 30, 1, 8, 0, 3650, 600, 1, 1, 24)`
    ).bind(LOCATION_ID, env.ORGANIZATION_ID),
    env.DB.prepare(
      `INSERT OR IGNORE INTO rooms (id, organization_id, location_id, name,
         accent_color, online_bookable, canvas_width, canvas_height, sort_order, is_active)
       VALUES ('room-1', ?, ?, 'Main', NULL, 1, 1200, 800, 0, 1)`
    ).bind(env.ORGANIZATION_ID, LOCATION_ID),
    env.DB.prepare(
      `INSERT OR IGNORE INTO service_periods (id, organization_id, location_id, name,
         day_of_week, start_time, end_time, last_seating_time, slot_interval_min,
         online_bookable, sort_order, is_active)
       VALUES ('period-fri', ?, ?, 'Dinner', 'fri', '18:00', '22:00', '21:00', NULL, 1, 0, 1)`
    ).bind(env.ORGANIZATION_ID, LOCATION_ID),
  ];

  for (let i = 1; i <= tableCount; i++) {
    statements.push(
      env.DB.prepare(
        `INSERT OR IGNORE INTO dining_tables (id, organization_id, location_id, room_id,
           label, seats_min, seats_max, shape, pos_x, pos_y, width, height, rotation,
           online_bookable, assign_priority, is_active, notes)
         VALUES (?, ?, ?, 'room-1', ?, 2, 4, 'square', ?, 0, 100, 100, 0, 1, 100, 1, NULL)`
      ).bind(
        `tbl-${i}`,
        env.ORGANIZATION_ID,
        LOCATION_ID,
        String(i),
        i * 150
      )
    );
  }

  await env.DB.batch(statements);
}

async function clearBookings(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM reservation_hold_tables`),
    env.DB.prepare(`DELETE FROM reservation_holds`),
    env.DB.prepare(`DELETE FROM reservation_tables`),
    env.DB.prepare(`DELETE FROM reservation_events`),
    env.DB.prepare(`DELETE FROM reservations`),
    env.DB.prepare(`DELETE FROM domain_events`),
  ]);
}

function booking(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    guestName: "Sarah Jones",
    guestPhone: "+447700900123",
    partySize: 2,
    serviceDate: DATE,
    startTime: "19:00",
    ...overrides,
  });
}

async function countRows(sql: string, ...binds: unknown[]): Promise<number> {
  const row = await env.DB.prepare(sql)
    .bind(...binds)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

let token = "";

beforeEach(async () => {
  await clearBookings();
  await seedVenue();
  token = await seedStaff();
});

describe("GET /service/availability", () => {
  it("requires a session", async () => {
    const res = await call(`/service/availability?date=${DATE}`);
    expect(res.status).toBe(401);
  });

  it("returns slots including unavailable ones with a reason", async () => {
    const res = await call(`/service/availability?date=${DATE}&partySize=2`, {
      token,
    });
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      slots: { time: string; available: boolean; reason?: string }[];
    };
    expect(body.slots.length).toBeGreaterThan(0);
    // Every unavailable slot explains itself — the endpoint exists to answer
    // "why can't I book 8pm".
    expect(
      body.slots.filter((s) => !s.available).every((s) => Boolean(s.reason))
    ).toBe(true);
  });

  it("rejects a nonsense party size", async () => {
    const res = await call(`/service/availability?date=${DATE}&partySize=0`, {
      token,
    });
    expect(res.status).toBe(400);
  });
});

describe("POST /service/reservations", () => {
  it("creates a reservation, assigns a table, and returns 201", async () => {
    const res = await call("/service/reservations", {
      method: "POST",
      token,
      body: booking(),
    });
    expect(res.status).toBe(201);

    const body = (await res.json()) as {
      id: string;
      reference: string;
      status: string;
      endTime: string;
      tableIds: string[];
    };
    expect(body.status).toBe("confirmed");
    expect(body.tableIds).toHaveLength(1);
    expect(body.endTime).toBe("20:30");
    expect(body.reference).toMatch(/^[0-9A-HJKMNP-TV-Z]{6}$/);
  });

  it("consumes its hold, leaving nothing to block the next booking", async () => {
    await call("/service/reservations", { method: "POST", token, body: booking() });

    expect(
      await countRows(
        `SELECT COUNT(*) AS n FROM reservation_holds WHERE consumed_at IS NULL`
      )
    ).toBe(0);
  });

  it("emits reservation.created and writes a reservation_events row", async () => {
    const res = await call("/service/reservations", {
      method: "POST",
      token,
      body: booking(),
    });
    const { id } = (await res.json()) as { id: string };

    expect(
      await countRows(
        `SELECT COUNT(*) AS n FROM domain_events WHERE type = 'reservation.created'`
      )
    ).toBe(1);
    expect(
      await countRows(
        `SELECT COUNT(*) AS n FROM reservation_events
         WHERE reservation_id = ? AND type = 'created' AND actor = 'staff:staff-res'`,
        id
      )
    ).toBe(1);
  });

  it("returns 409 SLOT_TAKEN with alternatives when the floor is full", async () => {
    // Three tables, three bookings, then a fourth at the same time.
    for (let i = 0; i < 3; i++) {
      const res = await call("/service/reservations", {
        method: "POST",
        token,
        body: booking({ guestName: `Guest ${i}` }),
      });
      expect(res.status).toBe(201);
    }

    const res = await call("/service/reservations", {
      method: "POST",
      token,
      body: booking({ guestName: "Unlucky" }),
    });
    expect(res.status).toBe(409);

    const body = (await res.json()) as {
      code: string;
      details: { alternatives: { time: string; available: boolean }[] };
    };
    expect(body.code).toBe("SLOT_TAKEN");
    // Never a bare conflict.
    expect(body.details.alternatives.length).toBeGreaterThan(0);
    expect(body.details.alternatives.every((a) => a.available)).toBe(true);
  });

  it("locks the assignment when staff name the tables explicitly", async () => {
    const res = await call("/service/reservations", {
      method: "POST",
      token,
      body: booking({ tableIds: ["tbl-3"] }),
    });
    const body = (await res.json()) as {
      tableIds: string[];
      assignmentLocked: boolean;
    };
    expect(body.tableIds).toEqual(["tbl-3"]);
    expect(body.assignmentLocked).toBe(true);
  });

  it("rejects an invalid body", async () => {
    const res = await call("/service/reservations", {
      method: "POST",
      token,
      body: JSON.stringify({ guestName: "", partySize: 0 }),
    });
    expect(res.status).toBe(400);
  });
});

describe("GET /service/reservations/:id", () => {
  it("returns the reservation with its event log", async () => {
    const created = await call("/service/reservations", {
      method: "POST",
      token,
      body: booking(),
    });
    const { id } = (await created.json()) as { id: string };

    const res = await call(`/service/reservations/${id}`, { token });
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      reservation: { id: string };
      events: { type: string; actor: string }[];
    };
    expect(body.reservation.id).toBe(id);
    expect(body.events[0].type).toBe("created");
  });

  it("404s an unknown id", async () => {
    const res = await call("/service/reservations/nope", { token });
    expect(res.status).toBe(404);
  });
});

describe("PATCH /service/reservations/:id", () => {
  async function create(overrides: Record<string, unknown> = {}) {
    const res = await call("/service/reservations", {
      method: "POST",
      token,
      body: booking(overrides),
    });
    return (await res.json()) as {
      id: string;
      tableIds: string[];
      assignmentLocked: boolean;
    };
  }

  it("updates notes without touching the assignment", async () => {
    const created = await create();
    const res = await call(`/service/reservations/${created.id}`, {
      method: "PATCH",
      token,
      body: JSON.stringify({ staffNotes: "Window table please" }),
    });
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      reservation: { staffNotes: string; tableIds: string[] };
    };
    expect(body.reservation.staffNotes).toBe("Window table please");
    expect(body.reservation.tableIds).toEqual(created.tableIds);
  });

  it("re-solves the assignment when the time moves and nothing is locked", async () => {
    const created = await create();
    const res = await call(`/service/reservations/${created.id}`, {
      method: "PATCH",
      token,
      body: JSON.stringify({ startTime: "20:00" }),
    });
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      reservation: { startTime: string; endTime: string; tableIds: string[] };
    };
    expect(body.reservation.startTime).toBe("20:00");
    expect(body.reservation.endTime).toBe("21:30");
    expect(body.reservation.tableIds).toHaveLength(1);
  });

  it("emits reservation.updated", async () => {
    const created = await create();
    await call(`/service/reservations/${created.id}`, {
      method: "PATCH",
      token,
      body: JSON.stringify({ partySize: 3 }),
    });

    expect(
      await countRows(
        `SELECT COUNT(*) AS n FROM domain_events WHERE type = 'reservation.updated'`
      )
    ).toBe(1);
  });

  it("409s ASSIGNMENT_CONFLICT rather than silently unlocking", async () => {
    // Locked onto tbl-1 for 19:00–20:30.
    const locked = await create({ tableIds: ["tbl-1"] });
    expect(locked.assignmentLocked).toBe(true);

    // Blocker at 20:30 on the same table: adjacent to the current window so it
    // books cleanly, but it overlaps the 20:00–21:30 window the move wants.
    const blocker = await call("/service/reservations", {
      method: "POST",
      token,
      body: booking({
        guestName: "Blocker",
        startTime: "20:30",
        tableIds: ["tbl-1"],
      }),
    });
    expect(blocker.status).toBe(201);

    const res = await call(`/service/reservations/${locked.id}`, {
      method: "PATCH",
      token,
      body: JSON.stringify({ startTime: "20:00" }),
    });
    expect(res.status).toBe(409);

    const body = (await res.json()) as {
      code: string;
      details: {
        conflictingTableIds: string[];
        suggestedAssignment: { tableIds: string[] } | null;
      };
    };
    expect(body.code).toBe("ASSIGNMENT_CONFLICT");
    expect(body.details.conflictingTableIds).toContain("tbl-1");
    // The recovery is offered, not just the refusal.
    expect(body.details.suggestedAssignment?.tableIds.length).toBeGreaterThan(0);

    // Nothing was written.
    const after = await call(`/service/reservations/${locked.id}`, { token });
    const afterBody = (await after.json()) as {
      reservation: { startTime: string; assignmentLocked: boolean };
    };
    expect(afterBody.reservation.startTime).toBe("19:00");
    expect(afterBody.reservation.assignmentLocked).toBe(true);
  });

  it("keeps locked tables when they are still free at the new time", async () => {
    const locked = await create({ tableIds: ["tbl-2"] });
    const res = await call(`/service/reservations/${locked.id}`, {
      method: "PATCH",
      token,
      body: JSON.stringify({ startTime: "20:00" }),
    });
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      reservation: { tableIds: string[]; assignmentLocked: boolean };
    };
    expect(body.reservation.tableIds).toEqual(["tbl-2"]);
    expect(body.reservation.assignmentLocked).toBe(true);
  });

  it("refuses to move a seated party", async () => {
    const created = await create();
    await call(`/service/reservations/${created.id}/status`, {
      method: "POST",
      token,
      body: JSON.stringify({ action: "seat" }),
    });

    const res = await call(`/service/reservations/${created.id}`, {
      method: "PATCH",
      token,
      body: JSON.stringify({ startTime: "20:00" }),
    });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe("ALREADY_SEATED");
  });

  it("succeeds with an UNASSIGNED warning when the new time has no table", async () => {
    const created = await create();
    // Fill every table at 20:00.
    for (let i = 1; i <= 3; i++) {
      await call("/service/reservations", {
        method: "POST",
        token,
        body: booking({
          guestName: `Filler ${i}`,
          startTime: "20:00",
          tableIds: [`tbl-${i}`],
        }),
      });
    }

    const res = await call(`/service/reservations/${created.id}`, {
      method: "PATCH",
      token,
      body: JSON.stringify({ startTime: "20:00" }),
    });
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      reservation: { tableIds: string[]; startTime: string };
      warning: string | null;
    };
    // Unassigned is a first-class state, not a reason to block the manager.
    expect(body.warning).toBe("UNASSIGNED");
    expect(body.reservation.tableIds).toEqual([]);
    expect(body.reservation.startTime).toBe("20:00");
  });
});

describe("POST /service/reservations/:id/status", () => {
  async function create() {
    const res = await call("/service/reservations", {
      method: "POST",
      token,
      body: booking(),
    });
    return (await res.json()) as { id: string };
  }

  it("walks confirmed → seated → finished", async () => {
    const { id } = await create();

    const seated = await call(`/service/reservations/${id}/status`, {
      method: "POST",
      token,
      body: JSON.stringify({ action: "seat" }),
    });
    expect(((await seated.json()) as { status: string }).status).toBe("seated");

    const finished = await call(`/service/reservations/${id}/status`, {
      method: "POST",
      token,
      body: JSON.stringify({ action: "finish" }),
    });
    const body = (await finished.json()) as {
      status: string;
      finishedAt: string;
    };
    expect(body.status).toBe("finished");
    expect(body.finishedAt).toBeTruthy();
  });

  it("rejects an impossible transition", async () => {
    const { id } = await create();
    const res = await call(`/service/reservations/${id}/status`, {
      method: "POST",
      token,
      body: JSON.stringify({ action: "finish" }),
    });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe(
      "INVALID_TRANSITION"
    );
  });

  it("frees the table once cancelled", async () => {
    // Fill all three, cancel one, and the slot opens again.
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const res = await call("/service/reservations", {
        method: "POST",
        token,
        body: booking({ guestName: `Guest ${i}` }),
      });
      ids.push(((await res.json()) as { id: string }).id);
    }

    expect(
      (
        await call("/service/reservations", {
          method: "POST",
          token,
          body: booking({ guestName: "Waiting" }),
        })
      ).status
    ).toBe(409);

    await call(`/service/reservations/${ids[0]}/status`, {
      method: "POST",
      token,
      body: JSON.stringify({ action: "cancel", reason: "Guest called" }),
    });

    expect(
      (
        await call("/service/reservations", {
          method: "POST",
          token,
          body: booking({ guestName: "Lucky" }),
        })
      ).status
    ).toBe(201);
  });

  it("clears the cancellation stamps on reinstate", async () => {
    const { id } = await create();
    await call(`/service/reservations/${id}/status`, {
      method: "POST",
      token,
      body: JSON.stringify({ action: "cancel", reason: "Mistake" }),
    });

    const res = await call(`/service/reservations/${id}/status`, {
      method: "POST",
      token,
      body: JSON.stringify({ action: "reinstate" }),
    });
    const body = (await res.json()) as {
      status: string;
      cancelledAt: string | null;
    };
    expect(body.status).toBe("confirmed");
    expect(body.cancelledAt).toBeNull();
  });

  it("emits reservation.status_changed with both ends of the transition", async () => {
    const { id } = await create();
    await call(`/service/reservations/${id}/status`, {
      method: "POST",
      token,
      body: JSON.stringify({ action: "seat" }),
    });

    const row = await env.DB.prepare(
      `SELECT payload_json FROM domain_events WHERE type = 'reservation.status_changed'`
    ).first<{ payload_json: string }>();
    const payload = JSON.parse(row!.payload_json) as {
      payload: { from: string; to: string };
    };
    expect(payload.payload).toMatchObject({ from: "confirmed", to: "seated" });
  });
});

describe("PUT /service/reservations/:id/tables", () => {
  async function create() {
    const res = await call("/service/reservations", {
      method: "POST",
      token,
      body: booking(),
    });
    return (await res.json()) as { id: string; tableIds: string[] };
  }

  it("moves the reservation and locks the assignment", async () => {
    const created = await create();
    const target = created.tableIds[0] === "tbl-1" ? "tbl-2" : "tbl-1";

    const res = await call(`/service/reservations/${created.id}/tables`, {
      method: "PUT",
      token,
      body: JSON.stringify({ tableIds: [target] }),
    });
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      tableIds: string[];
      assignmentLocked: boolean;
    };
    expect(body.tableIds).toEqual([target]);
    expect(body.assignmentLocked).toBe(true);
  });

  it("409s when the target table is already booked", async () => {
    const first = await create();
    const second = await call("/service/reservations", {
      method: "POST",
      token,
      body: booking({ guestName: "Other" }),
    });
    const other = (await second.json()) as { tableIds: string[] };

    const res = await call(`/service/reservations/${first.id}/tables`, {
      method: "PUT",
      token,
      body: JSON.stringify({ tableIds: other.tableIds }),
    });
    expect(res.status).toBe(409);

    const body = (await res.json()) as {
      code: string;
      details: { conflictingTableIds: string[] };
    };
    expect(body.code).toBe("SLOT_TAKEN");
    expect(body.details.conflictingTableIds).toEqual(other.tableIds);
  });

  it("rejects a table from another venue", async () => {
    const created = await create();
    const res = await call(`/service/reservations/${created.id}/tables`, {
      method: "PUT",
      token,
      body: JSON.stringify({ tableIds: ["tbl-elsewhere"] }),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe("UNKNOWN_TABLE");
  });

  it("emits reservation.assigned", async () => {
    const created = await create();
    const target = created.tableIds[0] === "tbl-1" ? "tbl-2" : "tbl-1";
    await call(`/service/reservations/${created.id}/tables`, {
      method: "PUT",
      token,
      body: JSON.stringify({ tableIds: [target] }),
    });

    expect(
      await countRows(
        `SELECT COUNT(*) AS n FROM domain_events WHERE type = 'reservation.assigned'`
      )
    ).toBe(1);
  });
});

describe("GET /service/day", () => {
  it("requires a session", async () => {
    const res = await call(`/service/day?date=${DATE}`);
    expect(res.status).toBe(401);
  });

  it("returns every status, not just the occupying ones", async () => {
    const created = await call("/service/reservations", {
      method: "POST",
      token,
      body: booking(),
    });
    const { id } = (await created.json()) as { id: string };
    await call(`/service/reservations/${id}/status`, {
      method: "POST",
      token,
      body: JSON.stringify({ action: "cancel", reason: "Test" }),
    });

    const res = await call(`/service/day?date=${DATE}`, { token });
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      serviceDate: string;
      reservations: { id: string; status: string; tableIds: string[] }[];
      periods: { id: string }[];
      settings: { timezone: string };
    };
    // A manager needs to see the cancellation, even though availability ignores it.
    expect(body.reservations.map((r) => r.status)).toContain("cancelled");
    expect(body.serviceDate).toBe(DATE);
    expect(body.settings.timezone).toBe("Europe/London");
    expect(body.periods).toHaveLength(1);
  });

  it("attaches table ids to each reservation without a query per booking", async () => {
    await call("/service/reservations", { method: "POST", token, body: booking() });
    const res = await call(`/service/day?date=${DATE}`, { token });
    const body = (await res.json()) as {
      reservations: { tableIds: string[] }[];
    };
    expect(body.reservations[0].tableIds).toHaveLength(1);
  });

  it("returns an empty day rather than failing", async () => {
    const res = await call("/service/day?date=2026-09-11", { token });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { reservations: [] }).reservations).toEqual([]);
  });

  it("rejects a malformed date", async () => {
    const res = await call("/service/day?date=tonight", { token });
    expect(res.status).toBe(400);
  });
});
