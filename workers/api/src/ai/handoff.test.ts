import { describe, expect, it } from "vitest";
import { detectSchedulingPreference } from "./handoff";

describe("detectSchedulingPreference", () => {
  it("detects day and time preferences", () => {
    expect(detectSchedulingPreference("Saturday mornings work best")).toBeTruthy();
    expect(detectSchedulingPreference("Tuesday after school")).toBeTruthy();
    expect(detectSchedulingPreference("We're free at 4:15pm")).toBeTruthy();
  });

  it("ignores non-scheduling messages", () => {
    expect(detectSchedulingPreference("Hi there")).toBeNull();
    expect(detectSchedulingPreference("What subjects do you offer?")).toBeNull();
  });
});
