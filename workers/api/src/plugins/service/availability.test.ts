import type {
  AvailabilityException,
  PacingRule,
  ServicePeriod,
  TableCombination,
  TurnTimeRule,
  VenueSettings,
} from "@lead-intake/shared-types";
import { describe, expect, it } from "vitest";
import type { AssignableTable } from "./assignment";
import {
  computeAvailability,
  type AvailabilityInput,
  type OccupancyRow,
} from "./availability";

/**
 * Written against the cases listed in spec §18. The venue is Europe/London
 * and `now` is always supplied explicitly — the engine has no ambient clock.
 */

const TZ = "Europe/London";

function settings(overrides: Partial<VenueSettings> = {}): VenueSettings {
  return {
    locationId: "venue-main",
    timezone: TZ,
    bookingSlug: "test-venue",
    slotIntervalMin: 15,
    defaultTurnMinutes: 90,
    graceAfterCloseMin: 30,
    minPartyOnline: 1,
    maxPartyOnline: 8,
    largePartyMessage: null,
    minLeadMinutes: 60,
    maxAdvanceDays: 90,
    holdTtlSeconds: 600,
    autoAssignTables: true,
    allowOnlineWaitlist: true,
    cancellationWindowHours: 24,
    brand: null,
    contactPhone: null,
    contactEmail: null,
    addressText: null,
    maxPartyCombined: 12,
    reviewUrl: null,
    reviewRequestDelayHours: 4,
    noShowGraceMin: 15,
    quietHoursStart: "21:00",
    quietHoursEnd: "08:00",
    retentionMonths: 24,
    ...overrides,
  };
}

function period(overrides: Partial<ServicePeriod> = {}): ServicePeriod {
  return {
    id: "period-dinner",
    name: "Dinner",
    dayOfWeek: "fri",
    startTime: "18:00",
    endTime: "22:00",
    lastSeatingTime: "21:00",
    slotIntervalMin: null,
    onlineBookable: true,
    sortOrder: 0,
    isActive: true,
    roomIds: ["room-main"],
    turnRules: [],
    pacingRules: [],
    ...overrides,
  };
}

function table(
  label: string,
  seatsMin: number,
  seatsMax: number,
  overrides: Partial<AssignableTable> = {}
): AssignableTable {
  return {
    id: `tbl-${label}`,
    label,
    seatsMin,
    seatsMax,
    shape: "square",
    posX: 0,
    posY: 0,
    width: 100,
    height: 100,
    rotation: 0,
    onlineBookable: true,
    assignPriority: 100,
    isActive: true,
    notes: null,
    roomId: "room-main",
    ...overrides,
  };
}

function exception(
  overrides: Partial<AvailabilityException> & { kind: AvailabilityException["kind"] }
): AvailabilityException {
  return {
    id: `exc-${overrides.kind}`,
    serviceDate: "2026-09-04",
    startTime: null,
    endTime: null,
    roomId: null,
    tableId: null,
    overrideLastSeating: null,
    note: null,
    ...overrides,
  };
}

/** 2026-09-04 is a Friday. 10:00 local, well before dinner. */
const NOW = new Date("2026-09-04T09:00:00Z");
const DATE = "2026-09-04";

function input(overrides: Partial<AvailabilityInput> = {}): AvailabilityInput {
  return {
    settings: settings(),
    periods: [period()],
    venueTurnRules: [],
    venuePacingRules: [],
    exceptions: [],
    tables: [table("1", 2, 4)],
    combinations: [] as TableCombination[],
    occupancy: [] as OccupancyRow[],
    serviceDate: DATE,
    partySize: 2,
    now: NOW,
    channel: "staff",
    ...overrides,
  };
}

const times = (slots: { time: string }[]) => slots.map((s) => s.time);
const availableTimes = (slots: { time: string; available: boolean }[]) =>
  slots.filter((s) => s.available).map((s) => s.time);

describe("slot generation", () => {
  it("steps at the venue interval from start to last seating inclusive", () => {
    const slots = computeAvailability(input());
    expect(times(slots)[0]).toBe("18:00");
    expect(times(slots).at(-1)).toBe("21:00");
    expect(slots).toHaveLength(13); // 18:00–21:00 at 15 min
  });

  it("lets a period override the venue slot interval", () => {
    const slots = computeAvailability(
      input({ periods: [period({ slotIntervalMin: 30 })] })
    );
    expect(times(slots)).toEqual([
      "18:00", "18:30", "19:00", "19:30",
      "20:00", "20:30", "21:00",
    ]);
  });

  it("generates across two periods in sort order", () => {
    const slots = computeAvailability(
      input({
        periods: [
          period({
            id: "period-dinner",
            startTime: "18:00",
            endTime: "22:00",
            lastSeatingTime: "18:30",
            sortOrder: 1,
          }),
          period({
            id: "period-lunch",
            startTime: "12:00",
            endTime: "15:00",
            lastSeatingTime: "12:30",
            sortOrder: 0,
          }),
        ],
      })
    );
    expect(times(slots)).toEqual(["12:00", "12:15", "12:30", "18:00", "18:15", "18:30"]);
  });
});

describe("last seating and grace", () => {
  it("allows a turn to run past close within the grace window", () => {
    // 21:00 + 90 = 22:30, close 22:00 + 30 grace = 22:30. Exactly on the edge.
    const slots = computeAvailability(input());
    const last = slots.find((s) => s.time === "21:00");
    expect(last?.available).toBe(true);
    expect(last?.endTime).toBe("22:30");
  });

  it("rejects a turn that runs past the grace window", () => {
    const slots = computeAvailability(
      input({ settings: settings({ graceAfterCloseMin: 15 }) })
    );
    const last = slots.find((s) => s.time === "21:00");
    expect(last?.available).toBe(false);
    expect(last?.reason).toBe("after_last_seating");
  });
});

describe("exceptions", () => {
  it("returns every slot unavailable with 'closed' on a closed day", () => {
    const slots = computeAvailability(
      input({ exceptions: [exception({ kind: "closed" })] })
    );
    expect(slots.length).toBeGreaterThan(0);
    expect(slots.every((s) => !s.available && s.reason === "closed")).toBe(true);
  });

  it("applies special_hours over the period's own times", () => {
    const slots = computeAvailability(
      input({
        exceptions: [
          exception({
            kind: "special_hours",
            startTime: "19:00",
            endTime: "23:00",
            overrideLastSeating: "19:30",
          }),
        ],
      })
    );
    expect(times(slots)).toEqual(["19:00", "19:15", "19:30"]);
  });

  it("blocks only the blocked table's capacity", () => {
    const slots = computeAvailability(
      input({
        tables: [table("1", 2, 4), table("2", 2, 4)],
        exceptions: [exception({ kind: "block_table", tableId: "tbl-1" })],
      })
    );
    // Still bookable, but never on the blocked table.
    expect(slots.every((s) => s.available)).toBe(true);
    expect(
      slots.every((s) => s.assignment?.tableIds.includes("tbl-2"))
    ).toBe(true);
  });

  it("blocks every table in a blocked room", () => {
    const slots = computeAvailability(
      input({
        tables: [table("1", 2, 4), table("2", 2, 4)],
        exceptions: [exception({ kind: "block_room", roomId: "room-main" })],
      })
    );
    expect(slots.every((s) => !s.available && s.reason === "no_table")).toBe(true);
  });

  it("marks slots staff_only for the online channel under a no_online exception", () => {
    const slots = computeAvailability(
      input({
        channel: "online",
        exceptions: [exception({ kind: "no_online" })],
      })
    );
    expect(slots.every((s) => s.reason === "staff_only")).toBe(true);
  });

  it("marks slots staff_only when the period is not online bookable", () => {
    const online = computeAvailability(
      input({ channel: "online", periods: [period({ onlineBookable: false })] })
    );
    expect(online.every((s) => s.reason === "staff_only")).toBe(true);

    const staff = computeAvailability(
      input({ channel: "staff", periods: [period({ onlineBookable: false })] })
    );
    expect(staff.some((s) => s.available)).toBe(true);
  });
});

describe("party bounds", () => {
  it("rejects a party over the online maximum", () => {
    const slots = computeAvailability(
      input({
        channel: "online",
        partySize: 12,
        tables: [table("1", 2, 20)],
        settings: settings({ maxPartyOnline: 8, maxPartyCombined: 8 }),
      })
    );
    expect(slots.every((s) => !s.available && s.reason === "party_too_large")).toBe(true);
  });

  it("does not bound the staff channel", () => {
    const slots = computeAvailability(
      input({
        channel: "staff",
        partySize: 12,
        tables: [table("1", 2, 20)],
        settings: settings({ maxPartyOnline: 8 }),
      })
    );
    expect(slots.some((s) => s.available)).toBe(true);
  });
});

describe("lead time and advance window", () => {
  it("marks slots before now as past", () => {
    // 20:00 local on the service date.
    const now = new Date("2026-09-04T19:00:00Z");
    const slots = computeAvailability(input({ now }));
    expect(slots.find((s) => s.time === "18:00")?.reason).toBe("past");
  });

  it("marks a slot inside the lead window as too_soon, at the exact minute", () => {
    // 18:00 local. Lead 60 min → 19:00 is the first bookable slot.
    const now = new Date("2026-09-04T17:00:00Z");
    const slots = computeAvailability(
      input({ now, settings: settings({ minLeadMinutes: 60 }) })
    );
    expect(slots.find((s) => s.time === "18:45")?.reason).toBe("too_soon");
    expect(slots.find((s) => s.time === "19:00")?.available).toBe(true);
  });

  it("marks a date beyond the advance window as too_far, at the boundary", () => {
    const withinLimit = computeAvailability(
      input({
        serviceDate: "2026-09-14",
        periods: [period({ dayOfWeek: "mon" })],
        settings: settings({ maxAdvanceDays: 10 }),
      })
    );
    expect(withinLimit.some((s) => s.available)).toBe(true);

    const pastLimit = computeAvailability(
      input({
        serviceDate: "2026-09-15",
        periods: [period({ dayOfWeek: "tue" })],
        settings: settings({ maxAdvanceDays: 10 }),
      })
    );
    expect(pastLimit.every((s) => s.reason === "too_far")).toBe(true);
  });
});

describe("occupancy", () => {
  it("treats adjacent bookings as non-overlapping", () => {
    // Existing booking ends exactly at 19:00; a 19:00 start must be free.
    const slots = computeAvailability(
      input({
        occupancy: [
          {
            sourceId: "res-1",
            kind: "reservation",
            tableId: "tbl-1",
            startTime: "17:30",
            endTime: "19:00",
            partySize: 2,
          },
        ],
      })
    );
    expect(slots.find((s) => s.time === "19:00")?.available).toBe(true);
    expect(slots.find((s) => s.time === "18:45")?.reason).toBe("no_table");
  });

  it("blocks a slot whose window overlaps an existing booking", () => {
    const slots = computeAvailability(
      input({
        occupancy: [
          {
            sourceId: "res-1",
            kind: "reservation",
            tableId: "tbl-1",
            startTime: "19:00",
            endTime: "20:30",
            partySize: 2,
          },
        ],
      })
    );
    expect(slots.find((s) => s.time === "19:00")?.reason).toBe("no_table");
  });

  it("counts a live hold as occupying", () => {
    const slots = computeAvailability(
      input({
        occupancy: [
          {
            sourceId: "hold-1",
            kind: "hold",
            tableId: "tbl-1",
            startTime: "19:00",
            endTime: "20:30",
            partySize: 2,
          },
        ],
      })
    );
    expect(slots.find((s) => s.time === "19:00")?.reason).toBe("no_table");
  });
});

describe("turn time specificity", () => {
  const rule = (
    id: string,
    partyMin: number,
    partyMax: number,
    turnMinutes: number
  ): TurnTimeRule => ({ id, partyMin, partyMax, turnMinutes });

  it("falls back to the venue default when no rule matches", () => {
    const slots = computeAvailability(input({ partySize: 2 }));
    expect(slots[0].turnMinutes).toBe(90);
  });

  it("prefers a venue rule over the default", () => {
    const slots = computeAvailability(
      input({ venueTurnRules: [rule("venue-wide", 1, 99, 120)] })
    );
    expect(slots[0].turnMinutes).toBe(120);
  });

  it("prefers a period rule over a venue rule", () => {
    const slots = computeAvailability(
      input({
        venueTurnRules: [rule("venue-wide", 1, 99, 120)],
        periods: [period({ turnRules: [rule("period-rule", 1, 99, 150)] })],
      })
    );
    expect(slots[0].turnMinutes).toBe(150);
  });

  it("prefers the narrower party range within the same scope", () => {
    const slots = computeAvailability(
      input({
        partySize: 2,
        venueTurnRules: [
          rule("wide", 1, 99, 120),
          rule("narrow", 1, 2, 75),
        ],
      })
    );
    expect(slots[0].turnMinutes).toBe(75);
  });
});

describe("pacing", () => {
  const pacing = (overrides: Partial<PacingRule> = {}): PacingRule => ({
    id: "pace-1",
    intervalMin: 15,
    maxCovers: 10,
    maxBookings: null,
    appliesFrom: null,
    appliesTo: null,
    isActive: true,
    ...overrides,
  });

  it("blocks a slot on the covers cap while tables are still free", () => {
    const slots = computeAvailability(
      input({
        partySize: 4,
        // Plenty of tables; the cap is what bites.
        tables: [table("1", 2, 4), table("2", 2, 4), table("3", 2, 4)],
        venuePacingRules: [pacing({ maxCovers: 8 })],
        occupancy: [
          {
            sourceId: "res-1",
            kind: "reservation",
            tableId: "tbl-3",
            startTime: "19:00",
            endTime: "20:30",
            partySize: 6,
          },
        ],
      })
    );
    const slot = slots.find((s) => s.time === "19:00");
    expect(slot?.available).toBe(false);
    expect(slot?.reason).toBe("pacing_full");
    // A free table existed — this is a pacing decision, not a floor one.
    expect(slots.find((s) => s.time === "19:15")?.available).toBe(true);
  });

  it("blocks on the bookings cap independently of covers", () => {
    const slots = computeAvailability(
      input({
        partySize: 2,
        tables: [table("1", 2, 4), table("2", 2, 4)],
        venuePacingRules: [
          pacing({ maxCovers: null, maxBookings: 1 }),
        ],
        occupancy: [
          {
            sourceId: "res-1",
            kind: "reservation",
            tableId: "tbl-2",
            startTime: "19:00",
            endTime: "20:30",
            partySize: 2,
          },
        ],
      })
    );
    expect(slots.find((s) => s.time === "19:00")?.reason).toBe("pacing_full");
  });

  /**
   * The bug this protects against: a booking on two joined tables produces two
   * occupancy rows, and counting both charges a 6-cover party as 12 against
   * the cap — closing slots that should be open.
   */
  it("counts a booking spanning two tables once, not once per table", () => {
    const twoTableBooking: OccupancyRow[] = [
      {
        sourceId: "res-joined",
        kind: "reservation",
        tableId: "tbl-2",
        startTime: "19:00",
        endTime: "20:30",
        partySize: 6,
      },
      {
        sourceId: "res-joined",
        kind: "reservation",
        tableId: "tbl-3",
        startTime: "19:00",
        endTime: "20:30",
        partySize: 6,
      },
    ];

    const slots = computeAvailability(
      input({
        partySize: 4,
        tables: [table("1", 2, 4), table("2", 2, 4), table("3", 2, 4)],
        venuePacingRules: [pacing({ maxCovers: 10 })],
        occupancy: twoTableBooking,
      })
    );

    // 6 committed + 4 requested = 10, exactly the cap. Double-counting would
    // make it 12 + 4 and wrongly block the slot.
    const slot = slots.find((s) => s.time === "19:00");
    expect(slot?.available).toBe(true);
    expect(slot?.remainingCovers).toBe(4);
  });

  it("counts unassigned bookings, which carry a null tableId", () => {
    const slots = computeAvailability(
      input({
        partySize: 4,
        tables: [table("1", 2, 4), table("2", 2, 4)],
        venuePacingRules: [pacing({ maxCovers: 8 })],
        occupancy: [
          {
            sourceId: "res-unassigned",
            kind: "reservation",
            tableId: null,
            startTime: "19:00",
            endTime: "20:30",
            partySize: 6,
          },
        ],
      })
    );
    // The unassigned booking holds no table but still consumes the cap.
    expect(slots.find((s) => s.time === "19:00")?.reason).toBe("pacing_full");
  });

  it("only applies a rule inside its own time window", () => {
    const slots = computeAvailability(
      input({
        partySize: 4,
        tables: [table("1", 2, 4), table("2", 2, 4)],
        venuePacingRules: [
          pacing({ maxCovers: 4, appliesFrom: "20:00", appliesTo: "21:00" }),
        ],
        occupancy: [
          {
            sourceId: "res-1",
            kind: "reservation",
            tableId: "tbl-2",
            startTime: "20:00",
            endTime: "21:30",
            partySize: 4,
          },
        ],
      })
    );
    expect(slots.find((s) => s.time === "19:00")?.available).toBe(true);
    expect(slots.find((s) => s.time === "20:00")?.reason).toBe("pacing_full");
  });

  it("prefers period pacing rules over venue ones", () => {
    const slots = computeAvailability(
      input({
        partySize: 4,
        tables: [table("1", 2, 4), table("2", 2, 4)],
        venuePacingRules: [pacing({ id: "venue", maxCovers: 4 })],
        periods: [
          period({ pacingRules: [pacing({ id: "period", maxCovers: 100 })] }),
        ],
      })
    );
    expect(slots.find((s) => s.time === "19:00")?.available).toBe(true);
  });
});

describe("reason contract", () => {
  it("gives every unavailable slot a reason", () => {
    const slots = computeAvailability(
      input({
        tables: [],
        settings: settings({ graceAfterCloseMin: 0 }),
      })
    );
    const unavailable = slots.filter((s) => !s.available);
    expect(unavailable.length).toBeGreaterThan(0);
    expect(unavailable.every((s) => typeof s.reason === "string")).toBe(true);
  });

  it("never returns an assignment on an unavailable slot", () => {
    const slots = computeAvailability(input({ tables: [] }));
    expect(slots.every((s) => s.available || s.assignment === null)).toBe(true);
  });

  it("returns no slots when the day has no active period", () => {
    expect(computeAvailability(input({ periods: [] }))).toEqual([]);
    expect(
      computeAvailability(input({ periods: [period({ isActive: false })] }))
    ).toEqual([]);
  });
});
