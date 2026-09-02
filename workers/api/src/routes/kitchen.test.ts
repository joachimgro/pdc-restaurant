import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import worker from "../index";
import { hashToken, SESSION_COOKIE } from "../auth/crypto";
import type { Env } from "../env";

const LOCATION_ID = "venue-kitchen-test";

async function seedStaff(): Promise<string> {
  const token = `token-${crypto.randomUUID()}`;
  await env.DB.batch([
    env.DB.prepare(
      `INSERT OR IGNORE INTO staff_users (id, organization_id, email, name, role, status)
       VALUES ('staff-kitchen', ?, 'kitchen@example.com', 'Kitchen Staff', 'member', 'active')`
    ).bind(env.ORGANIZATION_ID),
    env.DB.prepare(
      `INSERT INTO staff_sessions (id, user_id, token_hash, expires_at)
       VALUES (?, 'staff-kitchen', ?, ?)`
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
  return worker.fetch(
    new Request(`https://api.test${path}`, { ...rest, headers }),
    env as unknown as Env
  );
}

async function seedMenu(): Promise<void> {
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT OR IGNORE INTO organizations (id, name) VALUES (?, 'Test Org')`
    ).bind(env.ORGANIZATION_ID),
    env.DB.prepare(
      `INSERT OR IGNORE INTO locations (id, organization_id, name, abbrev)
       VALUES (?, ?, 'Kitchen Venue', 'KV')`
    ).bind(LOCATION_ID, env.ORGANIZATION_ID),
    env.DB.prepare(
      `INSERT OR REPLACE INTO menu_categories (
         id, organization_id, location_id, name, station, default_course,
         sort_order, is_active, created_at, updated_at
       ) VALUES ('cat-mains', ?, ?, 'Mains', 'restaurant', 'main', 10, 1, ?, ?)`
    ).bind(env.ORGANIZATION_ID, LOCATION_ID, now, now),
    env.DB.prepare(
      `INSERT OR REPLACE INTO menu_categories (
         id, organization_id, location_id, name, station, default_course,
         sort_order, is_active, created_at, updated_at
       ) VALUES ('cat-drinks', ?, ?, 'Drinks', 'bar', NULL, 20, 1, ?, ?)`
    ).bind(env.ORGANIZATION_ID, LOCATION_ID, now, now),
    env.DB.prepare(
      `INSERT OR REPLACE INTO menu_items (
         id, organization_id, location_id, category_id, name, station,
         price_pence, sort_order, is_active, available, choices, created_at, updated_at
       ) VALUES ('item-burger', ?, ?, 'cat-mains', 'House Burger', 'restaurant', 1650, 10, 1, 1, NULL, ?, ?)`
    ).bind(env.ORGANIZATION_ID, LOCATION_ID, now, now),
    env.DB.prepare(
      `INSERT OR REPLACE INTO menu_items (
         id, organization_id, location_id, category_id, name, station,
         price_pence, sort_order, is_active, available, choices, created_at, updated_at
       ) VALUES ('item-fries', ?, ?, 'cat-mains', 'Fries', 'restaurant', 450, 20, 1, 1, NULL, ?, ?)`
    ).bind(env.ORGANIZATION_ID, LOCATION_ID, now, now),
    env.DB.prepare(
      `INSERT OR REPLACE INTO menu_items (
         id, organization_id, location_id, category_id, name, station,
         price_pence, sort_order, is_active, available, choices, created_at, updated_at
       ) VALUES ('item-beer', ?, ?, 'cat-drinks', 'Lager', 'bar', 550, 10, 1, 1, NULL, ?, ?)`
    ).bind(env.ORGANIZATION_ID, LOCATION_ID, now, now),
    env.DB.prepare(
      `INSERT OR REPLACE INTO menu_items (
         id, organization_id, location_id, category_id, name, station,
         price_pence, sort_order, is_active, available, choices, created_at, updated_at
       ) VALUES ('item-steak', ?, ?, 'cat-mains', 'Ribeye', 'restaurant', 2850, 30, 1, 1, ?, ?, ?)`
    ).bind(
      env.ORGANIZATION_ID,
      LOCATION_ID,
      JSON.stringify([
        {
          label: "Temperature",
          required: true,
          options: ["Rare", "Medium rare", "Medium", "Medium well", "Well done"],
        },
      ]),
      now,
      now
    ),
  ]);
}

async function clearKitchen(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM kitchen_ticket_items`),
    env.DB.prepare(`DELETE FROM kitchen_tickets`),
  ]);
}

describe("kitchen tickets (pre-trial baseline)", () => {
  let token: string;

  beforeEach(async () => {
    await clearKitchen();
    await seedMenu();
    token = await seedStaff();
  });

  it("creates a ticket with items and snapshots menu item names", async () => {
    const res = await call(`/kitchen/tickets?locationId=${LOCATION_ID}`, {
      method: "POST",
      token,
      body: JSON.stringify({
        station: "restaurant",
        tableLabel: "12",
        items: [
          { menuItemId: "item-burger", qty: 2 },
          { menuItemId: "item-fries", qty: 1 },
        ],
      }),
    });
    expect(res.status).toBe(201);
    const ticket = (await res.json()) as {
      id: string;
      status: string;
      items: { name: string; qty: number; menuItemId: string | null }[];
    };
    expect(ticket.status).toBe("new");
    expect(ticket.items).toHaveLength(2);
    expect(ticket.items.map((i) => i.name).sort()).toEqual([
      "Fries",
      "House Burger",
    ]);
    expect(ticket.items.find((i) => i.name === "House Burger")?.qty).toBe(2);
  });

  it("bumps new → in_progress → ready → served", async () => {
    const created = await call(`/kitchen/tickets?locationId=${LOCATION_ID}`, {
      method: "POST",
      token,
      body: JSON.stringify({
        station: "restaurant",
        tableLabel: "7",
        items: [{ menuItemId: "item-burger", qty: 1 }],
      }),
    });
    const { id } = (await created.json()) as { id: string };

    for (const status of ["in_progress", "ready", "served"] as const) {
      const res = await call(
        `/kitchen/tickets/${id}/status?locationId=${LOCATION_ID}`,
        {
          method: "POST",
          token,
          body: JSON.stringify({ status }),
        }
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as { status: string };
      expect(body.status).toBe(status);
    }
  });

  it("voids from any state", async () => {
    const created = await call(`/kitchen/tickets?locationId=${LOCATION_ID}`, {
      method: "POST",
      token,
      body: JSON.stringify({
        station: "restaurant",
        tableLabel: "3",
        items: [{ menuItemId: "item-fries", qty: 1 }],
      }),
    });
    const { id } = (await created.json()) as { id: string };

    await call(`/kitchen/tickets/${id}/status?locationId=${LOCATION_ID}`, {
      method: "POST",
      token,
      body: JSON.stringify({ status: "in_progress" }),
    });

    const voided = await call(
      `/kitchen/tickets/${id}/status?locationId=${LOCATION_ID}`,
      {
        method: "POST",
        token,
        body: JSON.stringify({ status: "void" }),
      }
    );
    expect(voided.status).toBe(200);
    expect(((await voided.json()) as { status: string }).status).toBe("void");
  });

  it("rejects unknown menu items", async () => {
    const res = await call(`/kitchen/tickets?locationId=${LOCATION_ID}`, {
      method: "POST",
      token,
      body: JSON.stringify({
        station: "restaurant",
        tableLabel: "1",
        items: [{ menuItemId: "item-does-not-exist", qty: 1 }],
      }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("INVALID_MENU_ITEM");
  });
});

describe("kitchen orders (trial)", () => {
  let token: string;

  beforeEach(async () => {
    await clearKitchen();
    await seedMenu();
    token = await seedStaff();
  });

  it("creates one ticket per station in a batch", async () => {
    const orderKey = crypto.randomUUID();
    const res = await call(`/kitchen/orders?locationId=${LOCATION_ID}`, {
      method: "POST",
      token,
      body: JSON.stringify({
        orderKey,
        tableLabel: "12",
        covers: 4,
        serveMode: "courses",
        items: [
          { menuItemId: "item-burger", qty: 1, course: "main" },
          { menuItemId: "item-beer", qty: 2 },
        ],
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      tickets: { id: string; station: string; itemCount: number }[];
      replay: boolean;
    };
    expect(body.replay).toBe(false);
    expect(body.tickets).toHaveLength(2);
    expect(body.tickets.map((t) => t.station).sort()).toEqual(["bar", "restaurant"]);
  });

  it("replays the same orderKey without writing again", async () => {
    const orderKey = crypto.randomUUID();
    const payload = {
      orderKey,
      tableLabel: "9",
      serveMode: "as_it_comes" as const,
      items: [{ menuItemId: "item-fries", qty: 1, course: "main" as const }],
    };
    const first = await call(`/kitchen/orders?locationId=${LOCATION_ID}`, {
      method: "POST",
      token,
      body: JSON.stringify(payload),
    });
    const a = (await first.json()) as { tickets: { id: string }[] };
    const second = await call(`/kitchen/orders?locationId=${LOCATION_ID}`, {
      method: "POST",
      token,
      body: JSON.stringify(payload),
    });
    expect(second.status).toBe(200);
    const b = (await second.json()) as {
      tickets: { id: string }[];
      replay: boolean;
    };
    expect(b.replay).toBe(true);
    expect(b.tickets.map((t) => t.id)).toEqual(a.tickets.map((t) => t.id));

    const count = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM kitchen_tickets WHERE order_key = ?`
    )
      .bind(orderKey)
      .first<{ n: number }>();
    expect(count?.n).toBe(1);
  });

  it("rejects unavailable items for the whole order", async () => {
    await call(
      `/kitchen/menu/items/item-burger/availability?locationId=${LOCATION_ID}`,
      {
        method: "PATCH",
        token,
        body: JSON.stringify({ available: false }),
      }
    );
    const res = await call(`/kitchen/orders?locationId=${LOCATION_ID}`, {
      method: "POST",
      token,
      body: JSON.stringify({
        orderKey: crypto.randomUUID(),
        tableLabel: "4",
        serveMode: "all_together",
        items: [
          { menuItemId: "item-burger", qty: 1 },
          { menuItemId: "item-beer", qty: 1 },
        ],
      }),
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("ITEM_UNAVAILABLE");
  });

  it("round-trips courses and serveMode on the board", async () => {
    const orderKey = crypto.randomUUID();
    await call(`/kitchen/orders?locationId=${LOCATION_ID}`, {
      method: "POST",
      token,
      body: JSON.stringify({
        orderKey,
        tableLabel: "2",
        covers: 2,
        serveMode: "courses",
        items: [
          { menuItemId: "item-burger", qty: 1, course: "main", notes: "Medium rare" },
          { menuItemId: "item-fries", qty: 1, course: "starter" },
        ],
      }),
    });
    const list = await call(`/kitchen/tickets?locationId=${LOCATION_ID}`, {
      token,
    });
    const body = (await list.json()) as {
      tickets: {
        serveMode: string;
        covers: number;
        items: { course: string | null; name: string }[];
      }[];
    };
    const ticket = body.tickets.find((t) => t.covers === 2);
    expect(ticket?.serveMode).toBe("courses");
    expect(ticket?.items.map((i) => i.course)).toEqual(["starter", "main"]);
  });

  it("rejects malformed choices on create", async () => {
    const res = await call(`/kitchen/menu/items?locationId=${LOCATION_ID}`, {
      method: "POST",
      token,
      body: JSON.stringify({
        categoryId: "cat-mains",
        name: "Bad steak",
        choices: [{ label: "Temp", required: true, options: [] }],
      }),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe("INVALID_CHOICES");
  });

  it("toggles availability", async () => {
    const off = await call(
      `/kitchen/menu/items/item-steak/availability?locationId=${LOCATION_ID}`,
      {
        method: "PATCH",
        token,
        body: JSON.stringify({ available: false }),
      }
    );
    expect(off.status).toBe(200);
    expect(((await off.json()) as { item: { available: boolean } }).item.available).toBe(
      false
    );
    const menu = await call(`/kitchen/menu?locationId=${LOCATION_ID}`, { token });
    const cats = (await menu.json()) as {
      categories: { items: { id: string; available: boolean; choices: unknown }[] }[];
    };
    const steak = cats.categories
      .flatMap((c) => c.items)
      .find((i) => i.id === "item-steak");
    expect(steak?.available).toBe(false);
    expect(steak?.choices).toBeTruthy();
  });

  it("patches category station and defaultCourse", async () => {
    const res = await call(
      `/kitchen/menu/categories/cat-mains?locationId=${LOCATION_ID}`,
      {
        method: "PATCH",
        token,
        body: JSON.stringify({
          station: "restaurant",
          defaultCourse: "main",
        }),
      }
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      category: { defaultCourse: string | null; station: string };
    };
    expect(body.category.defaultCourse).toBe("main");
    expect(body.category.station).toBe("restaurant");
  });

  it("patches menu item choices", async () => {
    const choices = [
      {
        label: "Side",
        required: false,
        options: ["Fries", "Salad"],
      },
    ];
    const res = await call(
      `/kitchen/menu/items/item-burger?locationId=${LOCATION_ID}`,
      {
        method: "PATCH",
        token,
        body: JSON.stringify({ choices }),
      }
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      item: { choices: { label: string; options: string[] }[] | null };
    };
    expect(body.item.choices?.[0]?.label).toBe("Side");
    expect(body.item.choices?.[0]?.options).toEqual(["Fries", "Salad"]);
  });
});
