import { describe, expect, it } from "vitest";
import { canonicalPhone } from "./phone-utils";

describe("canonicalPhone", () => {
  it("converts UK national mobiles to E.164", () => {
    expect(canonicalPhone("07467809884")).toBe("+447467809884");
    expect(canonicalPhone("07467 809 884")).toBe("+447467809884");
  });

  it("leaves E.164 intact", () => {
    expect(canonicalPhone("+447467809884")).toBe("+447467809884");
  });
});
