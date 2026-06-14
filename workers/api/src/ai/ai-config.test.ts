import { describe, expect, it } from "vitest";
import { renderTemplate } from "./template-render";
import { looksLikeQuestion } from "./question-detect";

describe("renderTemplate", () => {
  it("substitutes allowed params", () => {
    const out = renderTemplate("Hi{{first_name}} at {{location_name}}", {
      first_name: " Sam",
      location_name: "North",
    });
    expect(out).toBe("Hi Sam at North");
  });

  it("strips unknown placeholders safely", () => {
    const out = renderTemplate("Hello {{evil}} world", {});
    expect(out).toBe("Hello world");
  });

  it("caps length at 320 chars", () => {
    const long = "x".repeat(400);
    const out = renderTemplate(long, {});
    expect(out.length).toBeLessThanOrEqual(320);
  });
});

describe("looksLikeQuestion", () => {
  it("detects questions", () => {
    expect(looksLikeQuestion("What classes do you run?")).toBe(true);
    expect(looksLikeQuestion("How much is a trial")).toBe(true);
    expect(looksLikeQuestion("Tell me about BJJ")).toBe(true);
  });

  it("does not treat greetings as questions", () => {
    expect(looksLikeQuestion("hi")).toBe(false);
    expect(looksLikeQuestion("Hey there")).toBe(false);
    expect(looksLikeQuestion("yes")).toBe(false);
  });
});
