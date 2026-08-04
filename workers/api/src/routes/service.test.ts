import { env } from "cloudflare:test";
import type { FloorPlan } from "@lead-intake/shared-types";
import { beforeEach, describe, expect, it } from "vitest";
import worker from "../index";
import { hashToken, SESSION_COOKIE } from "../auth/crypto";
import type { Env } from "../env";

const LOCATION_ID = "venue-1";

async function seedStaff(role: "admin" | "member"): Promise<string> {
  const token = `token-${role}-${crypto.randomUUID()}`;
  const userId = `staff-${role}`;
  const expiresAt = new Date(Date.now() + 3_600_000).toISOString();

  await env.DB.batch([
    env.DB.prepare(
      `INSERT OR IGNORE INTO staff_users (id, organization_id, email, name, role, status)
       VALUES (?, ?, ?, ?, ?, 'active')`
    ).bind(userId, env.ORGANIZATION_ID, `${role}@example.com`, role, role),
    env.DB.prepare(
      `INSERT INTO staff_sessions (id, user_id, token_hash, expires_at)
       VALUES (?, ?, ?, ?)`
    ).bind(crypto.randomUUID(), userId, await hashToken(token), expiresAt),
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
  // The test env provides DB and KV but no AI_QUEUE — /service/* never
  // enqueues, so the missing binding is unreachable from these routes.
  return worker.fetch(
    new Request(`https://api.test${path}`, { ...rest, headers }),
    env as unknown as Env
  );
}

const PLAN: FloorPlan = {
  rooms: [
    {
      id: "room-main",
      name: "Main Dining",
      accentColor: "#FF6B6B",
      onlineBookable: true,
      canvasWidth: 1200,
      canvasHeight: 800,
      sortOrder: 0,
      isActive: true,
      tables: [
        {
          id: "tbl-1",
          label: "1",
          seatsMin: 2,
          seatsMax: 4,
          shape: "round",
          posX: 100,
          posY: 100,
          width: 90,
          height: 90,
          rotation: 0,
          onlineBookable: true,
          assignPriority: 100,
          isActive: true,
          notes: null,
        },
        {
          id: "tbl-2",
          label: "2",
          seatsMin: 2,
          seatsMax: 4,
          shape: "square",
          posX: 300,
          posY: 100,
          width: 90,
          height: 90,
          rotation: 0,
          onlineBookable: true,
          assignPriority: 100,
          isActive: true,
          notes: "By the window",
        },
      ],
    },
  ],
  combinations: [
    {
      id: "combo-1",
      label: "1+2",
      seatsMin: 5,
      seatsMax: 8,
      assignPriority: 300,
      onlineBookable: true,
      isActive: true,
      tableIds: ["tbl-1", "tbl-2"],
    },
  ],
};

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare(
      `INSERT OR IGNORE INTO organizations (id, name) VALUES (?, ?)`
    ).bind(env.ORGANIZATION_ID, "Test Org"),
    env.DB.prepare(
      `INSERT OR IGNORE INTO locations (id, organization_id, name, abbrev)
       VALUES (?, ?, ?, ?)`
    ).bind(LOCATION_ID, env.ORGANIZATION_ID, "The Test Kitchen", "TTK"),
  ]);
});

describe("/service/* authorisation", () => {
  it("rejects an unauthenticated request", async () => {
    const res = await call("/service/floor-plan");
    expect(res.status).toBe(401);
  });

  it("rejects X-Admin-Secret, which is scoped to /admin/*", async () => {
    const res = await call("/service/floor-plan", {
      headers: { "X-Admin-Secret": "test-secret" },
    });
    expect(res.status).toBe(401);
  });

  it("lets a member read the floor plan", async () => {
    const token = await seedStaff("member");
    const res = await call("/service/floor-plan", { token });
    expect(res.status).toBe(200);
  });

  it("forbids a member from saving the floor plan", async () => {
    const token = await seedStaff("member");
    const res = await call("/service/floor-plan", {
      method: "PUT",
      token,
      body: JSON.stringify(PLAN),
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "FORBIDDEN" });
  });

  it("lets an admin save the floor plan", async () => {
    const token = await seedStaff("admin");
    const res = await call("/service/floor-plan", {
      method: "PUT",
      token,
      body: JSON.stringify(PLAN),
    });
    expect(res.status).toBe(200);
  });
});

describe("/service/floor-plan round trip", () => {
  it("reads back exactly what was written", async () => {
    const token = await seedStaff("admin");

    const put = await call("/service/floor-plan", {
      method: "PUT",
      token,
      body: JSON.stringify(PLAN),
    });
    expect(put.status).toBe(200);

    const before = await call("/service/floor-plan", { token });
    const beforeBody = await before.text();

    // The GET body must itself be a valid PUT body — that symmetry is what
    // makes the round-trip meaningful rather than a transform on both ends.
    const rePut = await call("/service/floor-plan", {
      method: "PUT",
      token,
      body: beforeBody,
    });
    expect(rePut.status).toBe(200);

    const after = await call("/service/floor-plan", { token });
    expect(await after.text()).toBe(beforeBody);
  });

  it("does not duplicate tables when the same plan is saved twice", async () => {
    const token = await seedStaff("admin");
    await call("/service/floor-plan", {
      method: "PUT",
      token,
      body: JSON.stringify(PLAN),
    });
    await call("/service/floor-plan", {
      method: "PUT",
      token,
      body: JSON.stringify(PLAN),
    });

    const res = await call("/service/floor-plan", { token });
    const plan = (await res.json()) as FloorPlan;
    expect(plan.rooms[0].tables).toHaveLength(2);
    expect(plan.combinations[0].tableIds).toEqual(["tbl-1", "tbl-2"]);
  });

  it("rejects an invalid plan without writing any of it", async () => {
    const token = await seedStaff("admin");
    await call("/service/floor-plan", {
      method: "PUT",
      token,
      body: JSON.stringify(PLAN),
    });

    const broken: FloorPlan = {
      rooms: [
        {
          ...PLAN.rooms[0],
          tables: [
            PLAN.rooms[0].tables[0],
            { ...PLAN.rooms[0].tables[1], posX: 1180 },
          ],
        },
      ],
      combinations: PLAN.combinations,
    };

    const res = await call("/service/floor-plan", {
      method: "PUT",
      token,
      body: JSON.stringify(broken),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string; details: unknown[] };
    expect(body.code).toBe("INVALID_FLOOR_PLAN");
    expect(body.details).toHaveLength(1);

    // The good plan is still intact — the failed save wrote nothing.
    const after = await call("/service/floor-plan", { token });
    const plan = (await after.json()) as FloorPlan;
    expect(plan.rooms[0].tables[1].posX).toBe(300);
  });
});

describe("/service/settings", () => {
  it("returns defaults before the venue is configured", async () => {
    const token = await seedStaff("member");
    const res = await call("/service/settings", { token });
    const body = (await res.json()) as { settings: Record<string, unknown> };
    expect(body.settings).toMatchObject({
      locationId: LOCATION_ID,
      timezone: "Europe/London",
      slotIntervalMin: 15,
      maxPartyOnline: 8,
    });
  });

  it("round-trips a saved settings body", async () => {
    const token = await seedStaff("admin");
    const initial = await call("/service/settings", { token });
    const { settings } = (await initial.json()) as {
      settings: Record<string, unknown>;
    };

    const put = await call("/service/settings", {
      method: "PUT",
      token,
      body: JSON.stringify({
        ...settings,
        bookingSlug: "the-test-kitchen",
        maxPartyOnline: 10,
        brand: { accent: "#123456" },
      }),
    });
    expect(put.status).toBe(200);

    const after = await call("/service/settings", { token });
    const body = (await after.json()) as { settings: Record<string, unknown> };
    expect(body.settings).toMatchObject({
      bookingSlug: "the-test-kitchen",
      maxPartyOnline: 10,
      brand: { accent: "#123456" },
    });
  });
});

describe("/service/periods", () => {
  it("creates a period with nested turn and pacing rules atomically", async () => {
    const token = await seedStaff("admin");

    const created = await call("/service/periods", {
      method: "POST",
      token,
      body: JSON.stringify({
        name: "Dinner",
        dayOfWeek: "fri",
        startTime: "17:30",
        endTime: "22:30",
        lastSeatingTime: "21:30",
        slotIntervalMin: 15,
        onlineBookable: true,
        sortOrder: 1,
        isActive: true,
        roomIds: ["room-main"],
        turnRules: [{ partyMin: 1, partyMax: 2, turnMinutes: 90 }],
        pacingRules: [
          {
            intervalMin: 15,
            maxCovers: 20,
            maxBookings: null,
            appliesFrom: "19:00",
            appliesTo: "21:00",
            isActive: true,
          },
        ],
      }),
    });
    expect(created.status).toBe(201);

    const res = await call("/service/periods", { token });
    const body = (await res.json()) as {
      periods: Array<{
        name: string;
        turnRules: unknown[];
        pacingRules: unknown[];
        roomIds: string[];
      }>;
    };
    expect(body.periods).toHaveLength(1);
    expect(body.periods[0].name).toBe("Dinner");
    expect(body.periods[0].turnRules).toHaveLength(1);
    expect(body.periods[0].pacingRules).toHaveLength(1);
    expect(body.periods[0].roomIds).toEqual(["room-main"]);
  });

  it("forbids a member from creating a period", async () => {
    const token = await seedStaff("member");
    const res = await call("/service/periods", {
      method: "POST",
      token,
      body: JSON.stringify({
        name: "Lunch",
        dayOfWeek: "sat",
        startTime: "12:00",
        endTime: "15:00",
        lastSeatingTime: "14:15",
        slotIntervalMin: null,
        onlineBookable: true,
        roomIds: [],
        turnRules: [],
        pacingRules: [],
      }),
    });
    expect(res.status).toBe(403);
  });
});
