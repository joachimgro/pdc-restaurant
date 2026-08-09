import { describe, expect, it } from "vitest";
import {
  getCapabilities,
  multiLocationEnabled,
  serviceEnabled,
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
  it("defaults every capability to off", () => {
    const env = mockEnv();
    expect(simpleSchedulingEnabled(env)).toBe(false);
    expect(multiLocationEnabled(env)).toBe(false);
    expect(serviceEnabled(env)).toBe(false);
    expect(getCapabilities(env)).toEqual({
      simpleScheduling: false,
      multiLocation: false,
      service: false,
      reservations: false,
      waitlist: false,
      deposits: false,
      floorPlan: false,
      autoAssign: false,
      kitchen: false,
    });
  });

  it("enables when env vars are true", () => {
    const env = mockEnv({
      ENABLE_SIMPLE_SCHEDULING: "true",
      ENABLE_MULTI_LOCATION: "true",
      ENABLE_SERVICE: "true",
      ENABLE_RESERVATIONS: "true",
      ENABLE_WAITLIST: "true",
      ENABLE_DEPOSITS: "true",
      ENABLE_FLOOR_PLAN: "true",
      ENABLE_AUTO_ASSIGN: "true",
      ENABLE_KITCHEN: "true",
    });
    expect(getCapabilities(env)).toEqual({
      simpleScheduling: true,
      multiLocation: true,
      service: true,
      reservations: true,
      waitlist: true,
      deposits: true,
      floorPlan: true,
      autoAssign: true,
      kitchen: true,
    });
  });

  it("treats anything but the string true as off", () => {
    const env = mockEnv({
      ENABLE_SERVICE: "TRUE",
      ENABLE_RESERVATIONS: "1",
      ENABLE_WAITLIST: "",
    });
    const caps = getCapabilities(env);
    expect(caps.service).toBe(false);
    expect(caps.reservations).toBe(false);
    expect(caps.waitlist).toBe(false);
  });
});
