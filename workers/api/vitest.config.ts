import path from "node:path";
import {
  cloudflareTest,
  readD1Migrations,
} from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig(async () => {
  // Read the full migration chain so the setup file can apply it to the
  // test D1 database (test/apply-migrations.ts).
  const migrationsPath = path.join(import.meta.dirname, "migrations");
  // 0004 / 0008 / 0010 are comment-only no-ops; applyD1Migrations() rejects
  // migrations with no executable statement, so drop them from the chain.
  const migrations = (await readD1Migrations(migrationsPath)).filter((m) =>
    m.queries.some((q) => q.replace(/--.*$/gm, "").trim().length > 0)
  );

  return {
    plugins: [
      cloudflareTest({
        // wrangler.toml is a CHANGE_ME client template and declares AI /
        // Vectorize / Queue bindings the test runtime doesn't provide, so the
        // test bindings are declared here directly instead of via configPath.
        miniflare: {
          compatibilityDate: "2025-06-01",
          d1Databases: ["DB"],
          kvNamespaces: ["RATE_LIMITS"],
          bindings: {
            ORGANIZATION_ID: "test",
            CORS_ORIGIN: "http://localhost:3000",
            ENABLE_SERVICE: "true",
            ADMIN_SEED_SECRET: "test-secret",
            TEST_MIGRATIONS: migrations,
          },
        },
      }),
    ],
    test: {
      setupFiles: ["./test/apply-migrations.ts"],
    },
  };
});
