import type { Env } from "./env";

export type Capabilities = {
  simpleScheduling: boolean;
  multiLocation: boolean;
  service: boolean;
  reservations: boolean;
  waitlist: boolean;
  deposits: boolean;
  floorPlan: boolean;
  autoAssign: boolean;
};

export function simpleSchedulingEnabled(env: Env): boolean {
  return env.ENABLE_SIMPLE_SCHEDULING === "true";
}

export function multiLocationEnabled(env: Env): boolean {
  return env.ENABLE_MULTI_LOCATION === "true";
}

export function serviceEnabled(env: Env): boolean {
  return env.ENABLE_SERVICE === "true";
}

export function reservationsEnabled(env: Env): boolean {
  return env.ENABLE_RESERVATIONS === "true";
}

export function waitlistEnabled(env: Env): boolean {
  return env.ENABLE_WAITLIST === "true";
}

export function depositsEnabled(env: Env): boolean {
  return env.ENABLE_DEPOSITS === "true";
}

export function floorPlanEnabled(env: Env): boolean {
  return env.ENABLE_FLOOR_PLAN === "true";
}

export function autoAssignEnabled(env: Env): boolean {
  return env.ENABLE_AUTO_ASSIGN === "true";
}

export function getCapabilities(env: Env): Capabilities {
  return {
    simpleScheduling: simpleSchedulingEnabled(env),
    multiLocation: multiLocationEnabled(env),
    service: serviceEnabled(env),
    reservations: reservationsEnabled(env),
    waitlist: waitlistEnabled(env),
    deposits: depositsEnabled(env),
    floorPlan: floorPlanEnabled(env),
    autoAssign: autoAssignEnabled(env),
  };
}
