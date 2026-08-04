// Ambient declarations — no top-level import, or these stop being global.
// `env` from "cloudflare:test" is typed as Cloudflare.Env, which this file
// populates with the bindings vitest.config.ts actually provides.

declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    RATE_LIMITS: KVNamespace;
    ORGANIZATION_ID: string;
    CORS_ORIGIN: string;
    ENABLE_SERVICE: string;
    ADMIN_SEED_SECRET: string;
    TEST_MIGRATIONS: import("cloudflare:test").D1Migration[];
  }
}
