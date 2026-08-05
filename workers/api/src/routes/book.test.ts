import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import worker from "../index";
import type { Env } from "../env";
import { dispatchDueNotifications } from "../notifications/dispatch";
import {
  cancelScheduledNotifications,
  scheduleNotification,
} from "../notifications/schedule";

const LOCATION_ID = "venue-1";
const DATE = "2026-09-04";

function call(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  return worker.fetch(
    new Request(`https://api.test${path}`, { ...init, headers }),
    env as unknown as Env
  );
}

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
      `INSERT OR REPLACE INTO venue_settings (location_id, organization_id, timezone,
         booking_slug, slot_interval_min, default_turn_minutes, grace_after_close_min,
         min_party_online, max_party_online, min_lead_minutes, max_advance_days,
         hold_ttl_seconds, auto_assign_tables, allow_online_waitlist,
         cancellation_window_hours, contact_phone, brand_json)
       VALUES (?, ?, 'Europe/London', 'test-venue', 15, 90, 30, 1, 8, 0, 3650, 600, 1, 1, 24,
               '+442079460000', '{"name":"Test Kitchen"}')`
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
    env.DB.prepare(
      `INSERT OR IGNORE INTO dining_tables (id, organization_id, location_id, room_id,
         label, seats_min, seats_max, shape, pos_x, pos_y, width, height, rotation,
         online_bookable, assign_priority, is_active, notes)
       VALUES ('tbl-1', ?, ?, 'room-1', '1', 2, 4, 'square', 0, 0, 100, 100, 0, 1, 100, 1, NULL)`
    ).bind(env.ORGANIZATION_ID, LOCATION_ID),
    env.DB.prepare(
      `INSERT OR IGNORE INTO dining_tables (id, organization_id, location_id, room_id,
         label, seats_min, seats_max, shape, pos_x, pos_y, width, height, rotation,
         online_bookable, assign_priority, is_active, notes)
       VALUES ('tbl-2', ?, ?, 'room-1', '2', 2, 4, 'square', 150, 0, 100, 100, 0, 1, 100, 1, NULL)`
    ).bind(env.ORGANIZATION_ID, LOCATION_ID),
  ]);
}

async function clearAll(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM notifications`),
    env.DB.prepare(`DELETE FROM guest_access_tokens`),
    env.DB.prepare(`DELETE FROM reservation_hold_tables`),
    env.DB.prepare(`DELETE FROM reservation_holds`),
    env.DB.prepare(`DELETE FROM reservation_tables`),
    env.DB.prepare(`DELETE FROM reservation_events`),
    env.DB.prepare(`DELETE FROM reservations`),
    env.DB.prepare(`DELETE FROM domain_events`),
  ]);
}

describe("public /book API", () => {
  beforeEach(async () => {
    await seedVenue();
    await clearAll();
  });

  it("returns generic 404 for unknown slug", async () => {
    const res = await call("/book/no-such-place/venue");
    expect(res.status).toBe(404);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("NOT_FOUND");
  });

  it("returns venue for known slug without auth", async () => {
    const res = await call("/book/test-venue/venue");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { name: string; minParty: number };
    expect(body.name).toBe("Test Kitchen");
    expect(body.minParty).toBe(1);
  });

  it("lists online-available slots only", async () => {
    const res = await call(
      `/book/test-venue/availability?date=${DATE}&party=2`
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      channel: string;
      slots: Array<{ time: string }>;
    };
    expect(body.channel).toBe("online");
    expect(body.slots.length).toBeGreaterThan(0);
    expect(body.slots.some((s) => s.time === "19:00")).toBe(true);
  });

  it("holds, reserves with idempotency, and manages cancel", async () => {
    const holdRes = await call("/book/test-venue/hold", {
      method: "POST",
      body: JSON.stringify({
        partySize: 2,
        serviceDate: DATE,
        startTime: "19:00",
      }),
    });
    expect(holdRes.status).toBe(200);
    const hold = (await holdRes.json()) as { holdToken: string };

    const key = `idem-${crypto.randomUUID()}`;
    const reserveBody = {
      holdToken: hold.holdToken,
      guestName: "Alex Guest",
      guestEmail: "alex@example.com",
      guestPhone: "+447700900999",
    };

    const r1 = await call("/book/test-venue/reserve", {
      method: "POST",
      headers: { "Idempotency-Key": key },
      body: JSON.stringify(reserveBody),
    });
    expect(r1.status).toBe(201);
    const first = (await r1.json()) as {
      reservation: { id: string; reference: string };
      manageToken: string;
    };
    expect(first.manageToken).toBeTruthy();

    const r2 = await call("/book/test-venue/reserve", {
      method: "POST",
      headers: { "Idempotency-Key": key },
      body: JSON.stringify(reserveBody),
    });
    expect(r2.status).toBe(200);
    const second = (await r2.json()) as { reservation: { id: string } };
    expect(second.reservation.id).toBe(first.reservation.id);

    const notifs = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM notifications WHERE reservation_id = ?`
    )
      .bind(first.reservation.id)
      .first<{ n: number }>();
    expect(Number(notifs?.n)).toBeGreaterThan(0);

    const manage = await call(`/book/manage/${first.manageToken}`);
    expect(manage.status).toBe(200);

    const cancel = await call(`/book/manage/${first.manageToken}/cancel`, {
      method: "POST",
      body: JSON.stringify({ reason: "plans changed" }),
    });
    expect(cancel.status).toBe(200);

    const status = await env.DB.prepare(
      `SELECT status FROM reservations WHERE id = ?`
    )
      .bind(first.reservation.id)
      .first<{ status: string }>();
    expect(status?.status).toBe("cancelled");

    const scheduled = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM notifications
       WHERE reservation_id = ? AND status = 'scheduled'`
    )
      .bind(first.reservation.id)
      .first<{ n: number }>();
    expect(Number(scheduled?.n)).toBe(0);
  });

  it("returns 409 with alternatives when hold loses the race", async () => {
    const hold1 = await call("/book/test-venue/hold", {
      method: "POST",
      body: JSON.stringify({
        partySize: 2,
        serviceDate: DATE,
        startTime: "19:00",
      }),
    });
    expect(hold1.status).toBe(200);

    // Only two tables — fill both with holds at same slot if needed.
    // Second hold for same tables should collide once first hold owns them.
    const hold2 = await call("/book/test-venue/hold", {
      method: "POST",
      body: JSON.stringify({
        partySize: 2,
        serviceDate: DATE,
        startTime: "19:00",
      }),
    });
    // With two tables, second party of 2 may still get the other table.
    // Book a third hold to force conflict if capacity remains, or accept 200.
    if (hold2.status === 200) {
      const hold3 = await call("/book/test-venue/hold", {
        method: "POST",
        body: JSON.stringify({
          partySize: 2,
          serviceDate: DATE,
          startTime: "19:00",
        }),
      });
      expect(hold3.status).toBe(409);
      const body = (await hold3.json()) as { code: string };
      expect(body.code).toBe("SLOT_TAKEN");
    } else {
      expect(hold2.status).toBe(409);
    }
  });
});

describe("notification dispatcher", () => {
  beforeEach(async () => {
    await seedVenue();
    await clearAll();
  });

  it("skips send when reservation is cancelled (send-time check)", async () => {
    const reservationId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO reservations (
         id, organization_id, location_id, reference, guest_name, party_size,
         service_date, start_time, end_time, starts_at_utc, status, source
       ) VALUES (?, ?, ?, 'ABC123', 'Alex', 2, ?, '19:00', '20:30', ?, 'cancelled', 'online')`
    )
      .bind(
        reservationId,
        env.ORGANIZATION_ID,
        LOCATION_ID,
        DATE,
        `${DATE}T18:00:00.000Z`
      )
      .run();

    await scheduleNotification(env as unknown as Env, {
      locationId: LOCATION_ID,
      reservationId,
      channel: "email",
      template: "reservation_reminder",
      toAddress: "alex@example.com",
      scheduledFor: new Date(Date.now() - 60_000),
      payload: {
        guestName: "Alex",
        reference: "ABC123",
        serviceDate: DATE,
        startTime: "19:00",
        partySize: 2,
        manageUrl: "https://example.com/manage/x",
        venueName: "Test Kitchen",
      },
    });

    const result = await dispatchDueNotifications(env as unknown as Env, {
      limit: 10,
    });
    expect(result.skipped).toBe(1);
    expect(result.sent).toBe(0);

    const row = await env.DB.prepare(
      `SELECT status FROM notifications WHERE reservation_id = ?`
    )
      .bind(reservationId)
      .first<{ status: string }>();
    expect(row?.status).toBe("skipped");
  });

  it("only one concurrent claim sends", async () => {
    const reservationId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO reservations (
         id, organization_id, location_id, reference, guest_name, party_size,
         service_date, start_time, end_time, starts_at_utc, status, source
       ) VALUES (?, ?, ?, 'DEF456', 'Alex', 2, ?, '19:00', '20:30', ?, 'confirmed', 'online')`
    )
      .bind(
        reservationId,
        env.ORGANIZATION_ID,
        LOCATION_ID,
        DATE,
        `${DATE}T18:00:00.000Z`
      )
      .run();

    await scheduleNotification(env as unknown as Env, {
      locationId: LOCATION_ID,
      reservationId,
      channel: "email",
      template: "reservation_reminder",
      toAddress: "alex@example.com",
      scheduledFor: new Date(Date.now() - 60_000),
      payload: {
        guestName: "Alex",
        reference: "DEF456",
        serviceDate: DATE,
        startTime: "19:00",
        partySize: 2,
        manageUrl: "https://example.com/manage/x",
        venueName: "Test Kitchen",
      },
    });

    const [a, b] = await Promise.all([
      dispatchDueNotifications(env as unknown as Env, { limit: 10 }),
      dispatchDueNotifications(env as unknown as Env, { limit: 10 }),
    ]);

    expect(a.claimed + b.claimed).toBe(1);
    // Without Resend keys, sendEmail returns null but still marks sent.
    expect(a.sent + b.sent).toBe(1);
  });

  it("cancelScheduledNotifications clears due reminders", async () => {
    const reservationId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO reservations (
         id, organization_id, location_id, reference, guest_name, party_size,
         service_date, start_time, end_time, starts_at_utc, status, source
       ) VALUES (?, ?, ?, 'GHI789', 'Alex', 2, ?, '19:00', '20:30', ?, 'confirmed', 'online')`
    )
      .bind(
        reservationId,
        env.ORGANIZATION_ID,
        LOCATION_ID,
        DATE,
        `${DATE}T18:00:00.000Z`
      )
      .run();

    await scheduleNotification(env as unknown as Env, {
      locationId: LOCATION_ID,
      reservationId,
      channel: "sms",
      template: "reservation_reminder_sms",
      toAddress: "+447700900999",
      scheduledFor: new Date(Date.now() + 3_600_000),
      payload: {
        guestName: "Alex",
        reference: "GHI789",
        serviceDate: DATE,
        startTime: "19:00",
        partySize: 2,
        manageUrl: "https://example.com/m",
        venueName: "Test Kitchen",
      },
    });

    const n = await cancelScheduledNotifications(
      env as unknown as Env,
      reservationId
    );
    expect(n).toBe(1);

    const after = await dispatchDueNotifications(env as unknown as Env, {
      limit: 10,
      now: new Date(Date.now() + 4_000_000),
    });
    expect(after.claimed).toBe(0);
  });
});
