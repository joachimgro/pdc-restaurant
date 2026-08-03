import type { Env } from "../src/env";

declare namespace Cloudflare {
  // Bindings provided by vitest.config.ts for `env` from "cloudflare:workers".
  interface Env {
    DB: D1Database;
    RATE_LIMITS: KVNamespace;
    ORGANIZATION_ID: string;
    CORS_ORIGIN: string;
    TEST_MIGRATIONS: import("cloudflare:test").D1Migration[];
  }
}

declare module "cloudflare:test" {
  // Typed `env` for test files importing from "cloudflare:test".
  interface ProvidedEnv extends Env {
    TEST_MIGRATIONS: import("cloudflare:test").D1Migration[];
  }
}
