import { env } from "cloudflare:test";
import { describe, expect, it, vi, afterEach } from "vitest";
import type { Env } from "../env";
import {
  parseSmsKeyword,
  suppressSmsPhone,
  isSmsSuppressed,
} from "./sms-suppression";
import { dispatchDueNotifications } from "./dispatch";

const e = () => env as unknown as Env;

describe("SMS STOP suppression", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("parses STOP and START keywords", () => {
    expect(parseSmsKeyword("STOP")).toBe("stop");
    expect(parseSmsKeyword("stop please")).toBe("stop");
    expect(parseSmsKeyword("UNSTOP")).toBe("start");
    expect(parseSmsKeyword("hello")).toBeNull();
  });

  it("STOP then dispatcher tick sends zero SMS", async () => {
    const phone = "+447700900888";
    await suppressSmsPhone(e(), phone, "stop");
    expect(await isSmsSuppressed(e(), phone)).toBe(true);

    await e()
      .DB.prepare(
        "INSERT OR IGNORE INTO organizations (id, name) VALUES (?, ?)"
      )
      .bind(e().ORGANIZATION_ID, "Test")
      .run();
    await e()
      .DB.prepare(
        `INSERT OR IGNORE INTO locations (id, organization_id, name, abbrev)
         VALUES (?, ?, ?, ?)`
      )
      .bind("loc-sms", e().ORGANIZATION_ID, "Venue", "V")
      .run();

    const reservationId = crypto.randomUUID();
    await e()
      .DB.prepare(
        `INSERT INTO reservations (
           id, organization_id, location_id, reference, guest_name, guest_phone,
           party_size, service_date, start_time, end_time, starts_at_utc,
           status, source, assignment_locked, deposit_required_pence, marketing_opt_in
         ) VALUES (?, ?, ?, 'R1', 'Sam', ?, 2, '2026-08-20', '19:00', '20:30',
                   '2026-08-20T18:00:00.000Z', 'confirmed', 'online', 0, 0, 0)`
      )
      .bind(reservationId, e().ORGANIZATION_ID, "loc-sms", phone)
      .run();

    await e()
      .DB.prepare(
        `INSERT INTO notifications (
           id, organization_id, location_id, reservation_id, channel, template,
           to_address, status, scheduled_for, attempts, idempotency_key
         ) VALUES (?, ?, ?, ?, 'sms', 'reminder', ?, 'scheduled', datetime('now', '-1 minute'), 0, ?)`
      )
      .bind(
        crypto.randomUUID(),
        e().ORGANIZATION_ID,
        "loc-sms",
        reservationId,
        phone,
        `idem-sms-${reservationId}`
      )
      .run();

    const sendSpy = vi.fn(async () => ({ id: "msg-should-not-send" }));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        sendSpy();
        return new Response(JSON.stringify({ data: { id: "x" } }), {
          status: 200,
        });
      })
    );

    // Enable SMS path in env for deliver(); suppression must still block.
    (e() as Env).ENABLE_BOOKING_SMS = "true";
    (e() as Env).TELNYX_API_KEY = "key";
    (e() as Env).TELNYX_FROM_NUMBER = "+447700900000";

    const result = await dispatchDueNotifications(e(), { limit: 10 });
    expect(result.sent).toBe(0);
    expect(result.skipped).toBeGreaterThanOrEqual(1);
    expect(sendSpy).not.toHaveBeenCalled();

    const row = await e()
      .DB.prepare(
        `SELECT status, error_text, provider_message_id FROM notifications
         WHERE reservation_id = ? AND channel = 'sms'`
      )
      .bind(reservationId)
      .first<{
        status: string;
        error_text: string | null;
        provider_message_id: string | null;
      }>();
    expect(row?.provider_message_id).toBeNull();
    expect(row?.status).toBe("skipped");
    expect(row?.error_text).toBe("sms_suppressed");
  });
});
