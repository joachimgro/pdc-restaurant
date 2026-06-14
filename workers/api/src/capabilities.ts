import type { Env } from "./env";

export type Capabilities = {
  simpleScheduling: boolean;
  multiLocation: boolean;
};

export function simpleSchedulingEnabled(env: Env): boolean {
  return env.ENABLE_SIMPLE_SCHEDULING === "true";
}

export function multiLocationEnabled(env: Env): boolean {
  return env.ENABLE_MULTI_LOCATION === "true";
}

export function getCapabilities(env: Env): Capabilities {
  return {
    simpleScheduling: simpleSchedulingEnabled(env),
    multiLocation: multiLocationEnabled(env),
  };
}
