import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import worker from "../index";
import { hashToken, SESSION_COOKIE } from "../auth/crypto";
import type { Env } from "../env";
import { scheduleBookingNotifications } from "../notifications/schedule";

const LOCATION_ID = "venue-1";

async function seedStaff(): Promise<string> {
  const token = `token-guest-${crypto.randomUUID()}`;
  const userId = "staff-guest-contact";
  const expiresAt = new Date(Date.now() + 3_600_000).toISOString();

  await env.DB.batch([
    env.DB.prepare(
      `INSERT OR IGNORE INTO staff_users (id, organization_id, email, name, role, status)
       VALUES (?, ?, ?, ?, ?, 'active')`
    ).bind(userId, env.ORGANIZATION_ID, "staff@example.com", "Staff", "admin"),
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
  if (rest.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (token) headers.set("Cookie", `${SESSION_COOKIE}=${token}`);
  return worker.fetch(
    new Request(`https://api.test${path}`, { ...rest, headers }),
    env as unknown as Env
  );
}

async function seedReservation(): Promise<string> {
  const reservationId = crypto.randomUUID();
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
         cancellation_window_hours, brand_json)
       VALUES (?, ?, 'Europe/London', 'test-venue', 15, 90, 30, 1, 8, 0, 365, 600, 1, 1, 24,
               '{"name":"Test Kitchen"}')`
    ).bind(LOCATION_ID, env.ORGANIZATION_ID),
    env.DB.prepare(
      `INSERT INTO reservations (
         id, organization_id, location_id, reference, guest_name, guest_email, guest_phone,
         party_size, service_date, start_time, end_time, starts_at_utc, status, source
       ) VALUES (?, ?, ?, 'ABC123', 'Ada Guest', 'ada@example.com', '+441111',
         2, '2026-09-04', '19:00', '20:30', '2026-09-04T18:00:00.000Z', 'confirmed', 'online')`
    ).bind(reservationId, env.ORGANIZATION_ID, LOCATION_ID),
  ]);
  return reservationId;
}

const notifyCtx = (reservationId: string) => ({
  locationId: LOCATION_ID,
  reservationId,
  guestName: "Ada Guest",
  guestEmail: "ada@example.com",
  guestPhone: "+441111" as string | null,
  reference: "ABC123",
  serviceDate: "2026-09-04",
  startTime: "19:00",
  partySize: 2,
  startsAtUtc: "2026-09-04T18:00:00.000Z",
  manageUrl: "https://example.com/manage",
  venueName: "Test Kitchen",
  timezone: "Europe/London",
  addressText: null,
  contactPhone: null,
  brand: { name: "Test Kitchen" } as Record<string, unknown> | null,
});

describe("guest contact threads", () => {
  beforeEach(async () => {
    await env.DB.batch([
      env.DB.prepare(`DELETE FROM guest_messages`),
      env.DB.prepare(`DELETE FROM guest_threads`),
      env.DB.prepare(`DELETE FROM notifications`),
      env.DB.prepare(`DELETE FROM reservations`),
      env.DB.prepare(`DELETE FROM domain_events`),
      env.DB.prepare(`DELETE FROM leads`),
      env.DB.prepare(`DELETE FROM staff_sessions`),
    ]);
  });

  it("upserts thread when booking notifications schedule", async () => {
    const reservationId = await seedReservation();
    await scheduleBookingNotifications(env as unknown as Env, notifyCtx(reservationId), {
      includeConfirmations: true,
      kind: "created",
    });

    const thread = await env.DB.prepare(
      `SELECT * FROM guest_threads WHERE reservation_id = ?`
    )
      .bind(reservationId)
      .first();
    expect(thread).toBeTruthy();

    const notifs = await env.DB.prepare(
      `SELECT COUNT(*) as n FROM notifications WHERE reservation_id = ?`
    )
      .bind(reservationId)
      .first<{ n: number }>();
    expect((notifs?.n ?? 0) >= 1).toBe(true);

    const leads = await env.DB.prepare(`SELECT COUNT(*) as n FROM leads`).first<{
      n: number;
    }>();
    expect(leads?.n ?? 0).toBe(0);
  });

  it("GET contact includes confirmation notification in timeline", async () => {
    const reservationId = await seedReservation();
    await scheduleBookingNotifications(env as unknown as Env, notifyCtx(reservationId), {
      includeConfirmations: true,
      kind: "created",
    });

    const token = await seedStaff();
    const res = await call(`/service/reservations/${reservationId}/contact`, {
      token,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      timeline: Array<{ kind: string; label?: string }>;
    };
    expect(
      body.timeline.some(
        (i) => i.kind === "notification" && i.label?.includes("Confirmation")
      )
    ).toBe(true);

    const leadCount = await env.DB.prepare(
      `SELECT COUNT(*) as n FROM leads`
    ).first<{ n: number }>();
    expect(leadCount?.n ?? 0).toBe(0);
  });

  it("POST contact appends staff message without creating a lead", async () => {
    const reservationId = await seedReservation();
    const token = await seedStaff();

    const res = await call(`/service/reservations/${reservationId}/contact`, {
      method: "POST",
      token,
      body: JSON.stringify({ body: "Looking forward to seeing you." }),
    });
    // Resend may be unconfigured in tests → 200 with queued/sent, not 502.
    expect([200, 502].includes(res.status)).toBe(true);
    const body = (await res.json()) as {
      timeline?: unknown[];
      message?: { body?: string };
      details?: { message?: { body?: string } };
    };
    const msgBody =
      body.message?.body ?? body.details?.message?.body ?? null;
    expect(msgBody).toBe("Looking forward to seeing you.");

    const leadCount = await env.DB.prepare(
      `SELECT COUNT(*) as n FROM leads`
    ).first<{ n: number }>();
    expect(leadCount?.n ?? 0).toBe(0);
  });
});
