import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../index";
import type { Env } from "../env";
import { upsertGuestThread } from "../plugins/service/db/guest-threads";

const LOCATION_ID = "venue-1";

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

async function seedReservation(email = "ada@example.com"): Promise<string> {
  const reservationId = crypto.randomUUID();
  const reference = `R${reservationId.slice(0, 6).toUpperCase()}`;
  await env.DB.batch([
    env.DB.prepare(
      `INSERT OR IGNORE INTO organizations (id, name) VALUES (?, 'Test Org')`
    ).bind(env.ORGANIZATION_ID),
    env.DB.prepare(
      `INSERT OR IGNORE INTO locations (id, organization_id, name, abbrev)
       VALUES (?, ?, 'Test Venue', 'TV')`
    ).bind(LOCATION_ID, env.ORGANIZATION_ID),
    env.DB.prepare(
      `INSERT INTO reservations (
         id, organization_id, location_id, reference, guest_name, guest_email, guest_phone,
         party_size, service_date, start_time, end_time, starts_at_utc, status, source
       ) VALUES (?, ?, ?, ?, 'Ada Guest', ?, '+441111',
         2, '2026-09-04', '19:00', '20:30', '2026-09-04T18:00:00.000Z', 'confirmed', 'online')`
    ).bind(reservationId, env.ORGANIZATION_ID, LOCATION_ID, reference, email),
  ]);
  return reservationId;
}

describe("POST /webhooks/resend", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    (env as unknown as Env).RESEND_API_KEY = "re_test";
    (env as unknown as Env).BOOKING_FROM_EMAIL = "admin@bookings.phiof.digital";
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("appends inbound guest_message for matched reservation email", async () => {
    const reservationId = await seedReservation("ada@example.com");
    await upsertGuestThread(env as unknown as Env, {
      locationId: LOCATION_ID,
      reservationId,
      guestName: "Ada Guest",
      guestEmail: "ada@example.com",
      guestPhone: "+441111",
    });

    const emailId = "recv-email-1";
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes(`/emails/receiving/${emailId}`)) {
        return new Response(
          JSON.stringify({
            id: emailId,
            from: "ada@example.com",
            subject: "Re: Booking ABC123",
            text: "Can we move to 8pm?",
            html: null,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      return originalFetch(input as RequestInfo, undefined);
    }) as typeof fetch;

    const res = await call("/webhooks/resend", {
      method: "POST",
      body: JSON.stringify({
        type: "email.received",
        data: {
          email_id: emailId,
          from: "ada@example.com",
          to: ["admin@bookings.phiof.digital"],
          subject: "Re: Booking ABC123",
        },
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; reservationId?: string };
    expect(body.ok).toBe(true);
    expect(body.reservationId).toBe(reservationId);

    const msg = await env.DB.prepare(
      `SELECT direction, body, subject FROM guest_messages
       WHERE direction = 'inbound' ORDER BY created_at DESC LIMIT 1`
    ).first<{ direction: string; body: string; subject: string }>();
    expect(msg?.body).toContain("8pm");
    expect(msg?.subject).toContain("ABC123");

    const leadCount = await env.DB.prepare(
      `SELECT COUNT(*) AS c FROM leads`
    ).first<{ c: number }>();
    expect(Number(leadCount?.c ?? 0)).toBe(0);
  });

  it("skips mail not addressed to booking inbox", async () => {
    const res = await call("/webhooks/resend", {
      method: "POST",
      body: JSON.stringify({
        type: "email.received",
        data: {
          email_id: "other-1",
          from: "ada@example.com",
          to: ["info@phiof.digital"],
          subject: "Hello",
        },
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { skipped?: boolean; reason?: string };
    expect(body.skipped).toBe(true);
    expect(body.reason).toBe("not_booking_inbox");
  });

  it("is idempotent on duplicate email_id", async () => {
    const reservationId = await seedReservation("bob@example.com");
    await upsertGuestThread(env as unknown as Env, {
      locationId: LOCATION_ID,
      reservationId,
      guestName: "Bob",
      guestEmail: "bob@example.com",
      guestPhone: null,
    });

    const emailId = "recv-dup";
    globalThis.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          id: emailId,
          text: "First",
          subject: "Hi",
        }),
        { status: 200 }
      )
    ) as typeof fetch;

    const payload = {
      type: "email.received",
      data: {
        email_id: emailId,
        from: "bob@example.com",
        to: ["admin@bookings.phiof.digital"],
        subject: "Hi",
      },
    };

    const first = await call("/webhooks/resend", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    expect((await first.json() as { ok: boolean }).ok).toBe(true);

    const second = await call("/webhooks/resend", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    const secondBody = (await second.json()) as { duplicate?: boolean };
    expect(secondBody.duplicate).toBe(true);

    const count = await env.DB.prepare(
      `SELECT COUNT(*) AS c FROM guest_messages WHERE direction = 'inbound'
       AND body = 'First'`
    ).first<{ c: number }>();
    expect(Number(count?.c ?? 0)).toBe(1);
  });
});
