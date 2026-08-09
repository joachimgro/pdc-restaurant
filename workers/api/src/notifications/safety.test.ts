import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import type { Env } from "../env";
import { dispatchDueNotifications } from "./dispatch";
import { getNotificationQueueStats } from "./queue-stats";
import { handleHealth } from "../routes/health";

const e = () => env as unknown as Env;

describe("restaurant notification safety", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  beforeEach(async () => {
    await e()
      .DB.prepare(
        `INSERT OR IGNORE INTO organizations (id, name) VALUES (?, 'Org')`
      )
      .bind(e().ORGANIZATION_ID)
      .run();
    await e()
      .DB.prepare(
        `INSERT OR IGNORE INTO locations (id, organization_id, name, abbrev)
         VALUES ('loc-safe', ?, 'V', 'V')`
      )
      .bind(e().ORGANIZATION_ID)
      .run();
    await e().DB.prepare(`DELETE FROM notifications`).run();
    await e()
      .DB.prepare(`DELETE FROM reservations WHERE location_id = 'loc-safe'`)
      .run();
  });

  it("settles stale sending with provider_message_id as sent (no double deliver)", async () => {
    const reservationId = crypto.randomUUID();
    const notifId = crypto.randomUUID();
    await e()
      .DB.prepare(
        `INSERT INTO reservations (
           id, organization_id, location_id, reference, guest_name, party_size,
           service_date, start_time, end_time, starts_at_utc, status, source,
           assignment_locked, deposit_required_pence, marketing_opt_in
         ) VALUES (?, ?, 'loc-safe', 'SAFE01', 'A', 2, '2026-08-20', '19:00', '20:30',
                   '2026-08-20T18:00:00.000Z', 'confirmed', 'online', 0, 0, 0)`
      )
      .bind(reservationId, e().ORGANIZATION_ID)
      .run();

    // Stuck in sending for >10 min with provider id already set
    await e()
      .DB.prepare(
        `INSERT INTO notifications (
           id, organization_id, location_id, reservation_id, channel, template,
           to_address, status, scheduled_for, attempts, provider_message_id,
           idempotency_key, updated_at
         ) VALUES (?, ?, 'loc-safe', ?, 'email', 'reservation_confirmed',
                   'a@example.com', 'sending', datetime('now', '-1 hour'), 1,
                   'already-sent-id', ?, datetime('now', '-20 minutes'))`
      )
      .bind(notifId, e().ORGANIZATION_ID, reservationId, `idem-${notifId}`)
      .run();

    let fetchCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        fetchCount += 1;
        return new Response(JSON.stringify({ id: "should-not" }), { status: 200 });
      })
    );
    (e() as Env).RESEND_API_KEY = "re_test";
    (e() as Env).BOOKING_FROM_EMAIL = "admin@bookings.phiof.digital";

    await dispatchDueNotifications(e(), { limit: 10 });

    expect(fetchCount).toBe(0);
    const row = await e()
      .DB.prepare(`SELECT status, provider_message_id FROM notifications WHERE id = ?`)
      .bind(notifId)
      .first<{ status: string; provider_message_id: string }>();
    expect(row?.status).toBe("sent");
    expect(row?.provider_message_id).toBe("already-sent-id");
  });

  it("skips reminder at or after booking start", async () => {
    const reservationId = crypto.randomUUID();
    await e()
      .DB.prepare(
        `INSERT INTO reservations (
           id, organization_id, location_id, reference, guest_name, party_size,
           service_date, start_time, end_time, starts_at_utc, status, source,
           assignment_locked, deposit_required_pence, marketing_opt_in
         ) VALUES (?, ?, 'loc-safe', 'SAFE02', 'A', 2, '2026-08-15', '12:00', '13:30',
                   '2026-08-15T11:00:00.000Z', 'confirmed', 'online', 0, 0, 0)`
      )
      .bind(reservationId, e().ORGANIZATION_ID)
      .run();

    await e()
      .DB.prepare(
        `INSERT INTO notifications (
           id, organization_id, location_id, reservation_id, channel, template,
           to_address, status, scheduled_for, attempts, idempotency_key
         ) VALUES (?, ?, 'loc-safe', ?, 'sms', 'reservation_reminder_sms',
                   '+447700900001', 'scheduled', '2026-08-15T15:00:00.000Z', 0, ?)`
      )
      .bind(
        crypto.randomUUID(),
        e().ORGANIZATION_ID,
        reservationId,
        `idem-late-${reservationId}`
      )
      .run();

    const result = await dispatchDueNotifications(e(), {
      limit: 10,
      now: new Date("2026-08-15T15:00:00.000Z"),
    });
    expect(result.skipped).toBe(1);
    expect(result.sent).toBe(0);
  });

  it("degrades /health when oldest due backlog exceeds threshold", async () => {
    const reservationId = crypto.randomUUID();
    await e()
      .DB.prepare(
        `INSERT INTO reservations (
           id, organization_id, location_id, reference, guest_name, party_size,
           service_date, start_time, end_time, starts_at_utc, status, source,
           assignment_locked, deposit_required_pence, marketing_opt_in
         ) VALUES (?, ?, 'loc-safe', 'SAFE03', 'A', 2, '2026-08-20', '19:00', '20:30',
                   '2026-08-20T18:00:00.000Z', 'confirmed', 'online', 0, 0, 0)`
      )
      .bind(reservationId, e().ORGANIZATION_ID)
      .run();

    await e()
      .DB.prepare(
        `INSERT INTO notifications (
           id, organization_id, location_id, reservation_id, channel, template,
           to_address, status, scheduled_for, attempts, idempotency_key
         ) VALUES (?, ?, 'loc-safe', ?, 'email', 'reservation_confirmed',
                   'a@example.com', 'scheduled', ?, 0, ?)`
      )
      .bind(
        crypto.randomUUID(),
        e().ORGANIZATION_ID,
        reservationId,
        new Date(Date.now() - 45 * 60 * 1000).toISOString(),
        `idem-backlog-${reservationId}`
      )
      .run();

    (e() as Env).NOTIFICATION_BACKLOG_ALERT_MINUTES = "20";
    const stats = await getNotificationQueueStats(e());
    expect(stats.alert.backlogOverdue).toBe(true);
    expect(stats.backlogDueNow).toBeGreaterThan(0);

    const res = await handleHealth(
      new Request("https://api.test/health"),
      e()
    );
    expect(res.status).toBe(503);
    const body = (await res.json()) as {
      checks: { notification_queue: { ok: boolean } };
      notificationQueue: { backlogDueNow: number };
    };
    expect(body.checks.notification_queue.ok).toBe(false);
    expect(body.notificationQueue.backlogDueNow).toBeGreaterThan(0);
  });
});
