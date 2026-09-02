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
         id, organization_id, location_id, name, station, sort_order, is_active, created_at, updated_at
       ) VALUES ('cat-mains', ?, ?, 'Mains', 'restaurant', 10, 1, ?, ?)`
    ).bind(env.ORGANIZATION_ID, LOCATION_ID, now, now),
    env.DB.prepare(
      `INSERT OR REPLACE INTO menu_items (
         id, organization_id, location_id, category_id, name, station,
         price_pence, sort_order, is_active, created_at, updated_at
       ) VALUES ('item-burger', ?, ?, 'cat-mains', 'House Burger', 'restaurant', 1650, 10, 1, ?, ?)`
    ).bind(env.ORGANIZATION_ID, LOCATION_ID, now, now),
    env.DB.prepare(
      `INSERT OR REPLACE INTO menu_items (
         id, organization_id, location_id, category_id, name, station,
         price_pence, sort_order, is_active, created_at, updated_at
       ) VALUES ('item-fries', ?, ?, 'cat-mains', 'Fries', 'restaurant', 450, 20, 1, ?, ?)`
    ).bind(env.ORGANIZATION_ID, LOCATION_ID, now, now),
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
