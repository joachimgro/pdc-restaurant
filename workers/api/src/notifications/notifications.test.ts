import { describe, expect, it } from "vitest";
import { deferIfQuietHours } from "../lib/venue-time";
import { localToUtc } from "../plugins/service/time";

describe("quiet hours / venue time", () => {
  it("defers evening SMS to next 08:00 Europe/London", () => {
    // 2026-09-04 22:30 London = BST (UTC+1) → 21:30Z
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
});
