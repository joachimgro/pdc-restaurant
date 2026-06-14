import { describe, expect, it } from "vitest";
import { isFactKnowledgeChunk } from "./rag";

describe("isFactKnowledgeChunk", () => {
  it("excludes conversation and platform playbook sources", () => {
    expect(isFactKnowledgeChunk("conversation/playbook.md")).toBe(false);
    expect(isFactKnowledgeChunk("platform/playbook")).toBe(false);
    expect(isFactKnowledgeChunk("portal")).toBe(true);
    expect(isFactKnowledgeChunk("schedule")).toBe(true);
    expect(isFactKnowledgeChunk("faq-general.md")).toBe(true);
  });
});
