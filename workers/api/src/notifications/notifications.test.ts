import { describe, expect, it } from "vitest";
import { deferIfQuietHours, deferToGuestSendWindow } from "../lib/venue-time";
import { localToUtc } from "../plugins/service/time";

describe("quiet hours / venue time", () => {
  it("defers evening SMS to next 08:00 Europe/London", () => {
    const evening = localToUtc("2026-09-04", "22:30", "Europe/London");
    const deferred = deferIfQuietHours(evening, "Europe/London");
    const nextMorning = localToUtc("2026-09-05", "08:00", "Europe/London");
    expect(deferred.toISOString()).toBe(nextMorning.toISOString());
  });

  it("leaves afternoon times alone", () => {
    const afternoon = localToUtc("2026-09-04", "15:00", "Europe/London");
    const deferred = deferIfQuietHours(afternoon, "Europe/London");
    expect(deferred.toISOString()).toBe(afternoon.toISOString());
  });

  it("honours a custom, non-wrapping quiet window", () => {
    const morning = localToUtc("2026-09-04", "09:30", "Europe/London");
    const deferred = deferIfQuietHours(morning, "Europe/London", {
      start: "09:00",
      end: "10:00",
    });
    const endOfWindow = localToUtc("2026-09-04", "10:00", "Europe/London");
    expect(deferred.toISOString()).toBe(endOfWindow.toISOString());
  });
});

describe("deferToGuestSendWindow", () => {
  it("moves 02:00 (post quiet) to 09:00", () => {
    const twoAm = localToUtc("2026-08-16", "02:00", "Europe/London");
    const deferred = deferToGuestSendWindow(twoAm, "Europe/London");
    expect(deferred.toISOString()).toBe(
      localToUtc("2026-08-16", "09:00", "Europe/London").toISOString()
    );
  });
});
