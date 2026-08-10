import { describe, expect, it } from "vitest";
import {
  MAX_ATTEMPTS,
  SMS_EARLIEST_LOCAL,
  SMS_QUIET_START_DEFAULT,
  SMS_REMINDER_HOURS_BEFORE,
  nextRetryScheduledFor,
  reminderSkipReason,
} from "./policy";
import { deferIfQuietHours, deferToGuestSendWindow } from "../lib/venue-time";
import { localToUtc } from "../plugins/service/time";

describe("reminderSkipReason", () => {
  const now = new Date("2026-08-15T18:00:00.000Z");

  it("skips reminders at or after booking start", () => {
    expect(
      reminderSkipReason(
        "reservation_reminder_sms",
        now,
        "2026-08-15T15:00:00.000Z",
        "2026-08-15T17:00:00.000Z"
      )
    ).toBe("reminder_past_start");
  });

  it("skips reminders more than 30 minutes past due", () => {
    expect(
      reminderSkipReason(
        "reservation_reminder",
        now,
        "2026-08-15T17:00:00.000Z",
        "2026-08-15T20:00:00.000Z",
        30
      )
    ).toBe("reminder_stale");
  });

  it("does not apply reminder rules to confirmations", () => {
    expect(
      reminderSkipReason(
        "reservation_confirmed",
        now,
        "2026-08-15T10:00:00.000Z",
        "2026-08-15T12:00:00.000Z"
      )
    ).toBeNull();
  });

  it("allows a fresh reminder before start", () => {
    expect(
      reminderSkipReason(
        "reservation_reminder_sms",
        now,
        "2026-08-15T17:50:00.000Z",
        "2026-08-15T20:00:00.000Z"
      )
    ).toBeNull();
  });
});

describe("SMS reminder lead + earliest send", () => {
  it("is four hours before start", () => {
    expect(SMS_REMINDER_HOURS_BEFORE).toBe(4);
  });

  it("defers a 05:00 T−4h slot to 07:00 local (not 08:00)", () => {
    const fiveAm = localToUtc("2026-08-16", "05:00", "Europe/London");
    const deferred = deferIfQuietHours(fiveAm, "Europe/London", {
      start: SMS_QUIET_START_DEFAULT,
      end: SMS_EARLIEST_LOCAL,
    });
    expect(deferred.toISOString()).toBe(
      localToUtc("2026-08-16", "07:00", "Europe/London").toISOString()
    );
  });

  it("leaves a 15:00 dinner T−4h alone (no morning pile-up)", () => {
    const threePm = localToUtc("2026-08-16", "15:00", "Europe/London");
    const deferred = deferIfQuietHours(threePm, "Europe/London", {
      start: SMS_QUIET_START_DEFAULT,
      end: SMS_EARLIEST_LOCAL,
    });
    expect(deferred.toISOString()).toBe(threePm.toISOString());
  });
});

describe("nextRetryScheduledFor", () => {
  it("backs off 5 / 15 / 45 / 120 minutes then null", () => {
    const now = new Date("2026-08-15T12:00:00.000Z");
    const jitter = () => 0;
    expect(nextRetryScheduledFor(1, now, jitter)?.toISOString()).toBe(
      "2026-08-15T12:05:00.000Z"
    );
    expect(nextRetryScheduledFor(2, now, jitter)?.toISOString()).toBe(
      "2026-08-15T12:15:00.000Z"
    );
    expect(nextRetryScheduledFor(3, now, jitter)?.toISOString()).toBe(
      "2026-08-15T12:45:00.000Z"
    );
    expect(nextRetryScheduledFor(4, now, jitter)?.toISOString()).toBe(
      "2026-08-15T14:00:00.000Z"
    );
    expect(nextRetryScheduledFor(MAX_ATTEMPTS, now, jitter)).toBeNull();
  });
});

describe("deferToGuestSendWindow (review requests)", () => {
  it("moves a 02:00 due (22:00 finish + 4h) to 09:00 local", () => {
    // 02:00 London BST = 01:00Z
    const twoAm = localToUtc("2026-08-16", "02:00", "Europe/London");
    const deferred = deferToGuestSendWindow(twoAm, "Europe/London");
    const nine = localToUtc("2026-08-16", "09:00", "Europe/London");
    expect(deferred.toISOString()).toBe(nine.toISOString());
  });

  it("leaves a 16:00 due alone", () => {
    const afternoon = localToUtc("2026-08-16", "16:00", "Europe/London");
    const deferred = deferToGuestSendWindow(afternoon, "Europe/London");
    expect(deferred.toISOString()).toBe(afternoon.toISOString());
  });
});
