// meta.test.ts and engine-boundary.test.ts read files through
// import.meta.glob, which Vite resolves at build time — workerd has no
// node:fs. Declared here rather than pulled in via "vite/client" because
// tsconfig's `types` is an explicit allowlist and vite is not a direct
// dependency, so its types do not resolve under pnpm's strict layout.
interface ImportMeta {
  glob<T = unknown>(
    pattern: string | string[],
    options?: { query?: string; import?: string; eager?: boolean }
  ): Record<string, T>;
}

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
