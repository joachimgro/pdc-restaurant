import { describe, expect, it } from "vitest";
import { buildSystemPrompt } from "./prompt";
import {
  getPlatformPlaybook,
  getVerticalPlaybook,
  resolvePresetId,
} from "./playbooks";

describe("playbooks", () => {
  it("platform playbook includes human voice and name discipline", () => {
    const p = getPlatformPlaybook();
    expect(p).toMatch(/once per message/i);
    expect(p).toMatch(/Thank you for your enquiry/i);
    expect(p).toMatch(/Never mention AI/i);
  });

  it("tuition vertical avoids gym booking language", () => {
    const p = getVerticalPlaybook("tuition-centre", { schedulingEnabled: false });
    expect(p).toMatch(/parents/i);
    expect(p).not.toMatch(/BJJ/i);
    expect(p).toMatch(/skills assessment/i);
  });

  it("martial-arts includes booking close when scheduling on", () => {
    const on = getVerticalPlaybook("martial-arts", { schedulingEnabled: true });
    const off = getVerticalPlaybook("martial-arts", { schedulingEnabled: false });
    expect(on).toMatch(/free trial/i);
    expect(off).not.toMatch(/mark booked/i);
  });

  it("resolvePresetId defaults to generic-service", () => {
    expect(resolvePresetId(null)).toBe("generic-service");
    expect(resolvePresetId("")).toBe("generic-service");
    expect(resolvePresetId("tuition-centre")).toBe("tuition-centre");
  });
});

describe("buildSystemPrompt", () => {
  const baseConfig = {
    organization_id: "test",
    academy_name: "Test Academy",
    tone: "Friendly",
    goals: "Help leads",
    rules: "Be honest",
    model_reply: "model",
    model_judge: "judge",
    safe_fallback_message: null,
    intake_context_label: null,
    preset_id: "tuition-centre",
  };

  it("includes vertical playbook and handoff mode when scheduling off", () => {
    const prompt = buildSystemPrompt(baseConfig, null, [], undefined, {
      schedulingEnabled: false,
      presetId: "tuition-centre",
    });
    expect(prompt).toMatch(/HANDOFF MODE/i);
    expect(prompt).toMatch(/tuition centre/i);
    expect(prompt).toMatch(/Never mention AI/i);
  });
});
