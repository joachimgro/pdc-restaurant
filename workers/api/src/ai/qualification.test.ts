import { describe, expect, it } from "vitest";
import {
  buildParseContext,
  isAwaitingChildDetailsInHistory,
  parseQualificationReply,
} from "./qualification";
import type { Lead } from "@lead-intake/shared-types";

describe("parseQualificationReply", () => {
  const aliases = {
    english: "English",
    maths: "Maths",
  };

  it("extracts name, English interest, and child signal from parent message", () => {
    const parsed = parseQualificationReply(
      "Joachim, I'm trying to get some English lessons for my daughter",
      aliases
    );
    expect(parsed.name).toBe("Joachim");
    expect(parsed.interest).toBe("English");
    expect(parsed.isChild).toBe(true);
  });

  it("does not treat She's 10 as a parent name when awaiting child age", () => {
    const history = [
      { role: "lead", text: "Joachim, I need English for my daughter" },
      {
        role: "ai",
        text: "Thanks Joachim! How old is your child, or what year are they in?",
      },
    ];
    expect(isAwaitingChildDetailsInHistory(history)).toBe(true);

    const ctx = {
      parentNameEstablished: true,
      awaitingChildDetails: true,
      childEnquiry: true,
    };
    const parsed = parseQualificationReply("She's 10", aliases, ctx);
    expect(parsed.name).toBeUndefined();
    expect(parsed.childAge).toBe(10);
    expect(parsed.isChild).toBe(true);
  });

  it("blocks pronoun artifacts even without parse context", () => {
    const parsed = parseQualificationReply("She's 10", aliases);
    expect(parsed.name).toBeUndefined();
    expect(parsed.childAge).toBe(10);
  });

  it("parses year group replies as child age", () => {
    const parsed = parseQualificationReply("Year 5", aliases, {
      awaitingChildDetails: true,
      childEnquiry: true,
      parentNameEstablished: true,
    });
    expect(parsed.childAge).toBe("Year 5");
    expect(parsed.name).toBeUndefined();
  });

  it("buildParseContext detects parent enquiry awaiting child age", () => {
    const lead = {
      id: "1",
      name: "Joachim",
      interest: "English",
      child: { name: "—", age: "—", experience: "First-timer" },
    } as Lead;
    const history = [
      { role: "lead", text: "Joachim, English for my daughter" },
      { role: "ai", text: "How old is your child, or what year are they in?" },
    ];
    const ctx = buildParseContext(lead, history, ["name", "interest", "child"]);
    expect(ctx.childEnquiry).toBe(true);
    expect(ctx.parentNameEstablished).toBe(true);
    expect(ctx.awaitingChildDetails).toBe(true);
  });
});
