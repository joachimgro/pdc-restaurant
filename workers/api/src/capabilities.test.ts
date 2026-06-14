import { describe, expect, it } from "vitest";
import {
  getCapabilities,
  multiLocationEnabled,
  simpleSchedulingEnabled,
} from "./capabilities";
import type { Env } from "./env";

function mockEnv(overrides: Partial<Env> = {}): Env {
  return {
    ORGANIZATION_ID: "test",
    CORS_ORIGIN: "http://localhost:3000",
    ...overrides,
  } as Env;
}

describe("capabilities", () => {
  it("defaults scheduling and multi-location to off", () => {
    const env = mockEnv();
    expect(simpleSchedulingEnabled(env)).toBe(false);
    expect(multiLocationEnabled(env)).toBe(false);
    expect(getCapabilities(env)).toEqual({
      simpleScheduling: false,
      multiLocation: false,
    });
  });

  it("enables when env vars are true", () => {
    const env = mockEnv({
      ENABLE_SIMPLE_SCHEDULING: "true",
      ENABLE_MULTI_LOCATION: "true",
    });
    expect(getCapabilities(env)).toEqual({
      simpleScheduling: true,
      multiLocation: true,
    });
  });
});
