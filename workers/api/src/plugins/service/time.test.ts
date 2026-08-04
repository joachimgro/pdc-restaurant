import { describe, expect, it } from "vitest";
import {
  addDays,
  addMinutes,
  dayOfWeekForDate,
  formatTime,
  isTimeWithin,
  localToUtcIso,
  minutesBetween,
  parseTime,
  venueLocalDate,
  venueLocalTime,
} from "./time";

const LONDON = "Europe/London";

describe("parseTime / formatTime", () => {
  it("round-trips ordinary times", () => {
    expect(parseTime("19:15")).toBe(1155);
    expect(formatTime(1155)).toBe("19:15");
  });

  it("keeps late-bar overflow past midnight", () => {
    expect(parseTime("25:30")).toBe(1530);
    expect(formatTime(1530)).toBe("25:30");
    expect(parseTime("24:00")).toBe(1440);
    expect(formatTime(1440)).toBe("24:00");
  });

  it("rejects malformed input rather than guessing", () => {
    expect(() => parseTime("7pm")).toThrow();
    expect(() => parseTime("19:75")).toThrow();
    expect(() => parseTime("99:00")).toThrow();
  });
});

describe("addMinutes", () => {
  it("crosses midnight into 24h+ rather than wrapping to 00:30", () => {
    expect(addMinutes("23:30", 60)).toBe("24:30");
    expect(addMinutes("23:30", 120)).toBe("25:30");
  });

  it("adds a turn time within the evening", () => {
    expect(addMinutes("19:15", 105)).toBe("21:00");
  });

  it("measures spans across the midnight boundary", () => {
    expect(minutesBetween("22:00", "25:30")).toBe(210);
  });
});

describe("isTimeWithin", () => {
  it("is start-inclusive and end-exclusive", () => {
    expect(isTimeWithin("17:30", "17:30", "22:00")).toBe(true);
    expect(isTimeWithin("22:00", "17:30", "22:00")).toBe(false);
    expect(isTimeWithin("24:30", "17:30", "25:30")).toBe(true);
  });
});

describe("dayOfWeekForDate", () => {
  it("maps calendar dates to day codes", () => {
    expect(dayOfWeekForDate("2026-10-25")).toBe("sun");
    expect(dayOfWeekForDate("2026-10-26")).toBe("mon");
    expect(dayOfWeekForDate("2026-08-04")).toBe("tue");
  });

  it("advances dates across a month boundary", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
  });
});

describe("localToUtc across the DST boundary", () => {
  // UK clocks go back at 02:00 BST on Sunday 25 October 2026.
  it("uses BST (+01:00) the evening before the change", () => {
    expect(localToUtcIso("2026-10-24", "19:00", LONDON)).toBe(
      "2026-10-24T18:00:00.000Z"
    );
  });

  it("uses BST before 02:00 on the change day", () => {
    expect(localToUtcIso("2026-10-25", "01:00", LONDON)).toBe(
      "2026-10-25T00:00:00.000Z"
    );
  });

  it("uses GMT after the change on the same day", () => {
    expect(localToUtcIso("2026-10-25", "19:00", LONDON)).toBe(
      "2026-10-25T19:00:00.000Z"
    );
  });

  it("uses GMT the day after the change", () => {
    expect(localToUtcIso("2026-10-26", "19:00", LONDON)).toBe(
      "2026-10-26T19:00:00.000Z"
    );
  });

  it("keeps a late-bar 25:30 on the opening day's shift", () => {
    // Friday 24 July, "25:30" = 01:30 on Saturday, BST (+01:00).
    expect(localToUtcIso("2026-07-24", "25:30", LONDON)).toBe(
      "2026-07-25T00:30:00.000Z"
    );
  });

  it("resolves the repeated hour to its first (BST) occurrence", () => {
    // 01:30 happens twice on 25 Oct 2026. The guest booking means the first.
    expect(localToUtcIso("2026-10-25", "01:30", LONDON)).toBe(
      "2026-10-25T00:30:00.000Z"
    );
  });

  it("handles a spring-forward date and a non-UK zone", () => {
    // Clocks go forward 29 March 2026; 19:00 local is 18:00 UTC.
    expect(localToUtcIso("2026-03-29", "19:00", LONDON)).toBe(
      "2026-03-29T18:00:00.000Z"
    );
    expect(localToUtcIso("2026-07-01", "19:00", "Europe/Paris")).toBe(
      "2026-07-01T17:00:00.000Z"
    );
  });
});

describe("venueLocalDate / venueLocalTime", () => {
  it("reports the venue's day, not the UTC day", () => {
    // 23:30 UTC in July is 00:30 the next day in London.
    const instant = new Date("2026-07-14T23:30:00.000Z");
    expect(venueLocalDate(instant, LONDON)).toBe("2026-07-15");
    expect(venueLocalTime(instant, LONDON)).toBe("00:30");
  });
});
