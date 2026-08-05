import { describe, expect, it } from "vitest";
import { EXPECTED_SCHEMA_VERSION } from "./meta";

/**
 * Makes the same-commit rule mechanical instead of disciplinary.
 *
 * Deploying a Worker whose EXPECTED_SCHEMA_VERSION is ahead of the applied
 * migration 503s all traffic, and the mistake is invisible in review — the
 * migration and the constant live in different directories. This fails the
 * build instead.
 *
 * import.meta.glob is resolved by Vite at build time, so no filesystem access
 * is needed: these tests run inside workerd, which has no node:fs.
 */
const migrationFiles = import.meta.glob("../migrations/*.sql", {
  query: "?raw",
  eager: true,
});

function migrationVersions(): string[] {
  return Object.keys(migrationFiles)
    .map((path) => /(\d{4})_[^/]*\.sql$/.exec(path)?.[1])
    .filter((v): v is string => Boolean(v))
    .sort();
}

describe("EXPECTED_SCHEMA_VERSION", () => {
  it("matches the highest-numbered migration on disk", () => {
    const versions = migrationVersions();
    expect(versions.length).toBeGreaterThan(0);
    expect(EXPECTED_SCHEMA_VERSION).toBe(versions[versions.length - 1]);
  });

  it("is a four-digit zero-padded string, so version compares stay ordered", () => {
    // meta.ts and the migrations both compare with `<` on the raw string.
    // "999" < "1000" is false, which would silently disable the guard.
    expect(EXPECTED_SCHEMA_VERSION).toMatch(/^\d{4}$/);
  });

  it("has no duplicate migration numbers", () => {
    const versions = migrationVersions();
    expect(new Set(versions).size).toBe(versions.length);
  });
});
