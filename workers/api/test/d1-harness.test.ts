import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

// Proves the vitest-pool-workers harness: real D1 with the full migration
// chain applied by test/apply-migrations.ts.
describe("D1 test harness", () => {
  it("applies the migration chain to the test database", async () => {
    const row = await env.DB.prepare(
      "SELECT value FROM _meta WHERE key = 'schema_version'"
    ).first<{ value: string }>();
    expect(row?.value).toBe("0022");
  });

  it("round-trips an org-scoped insert", async () => {
    await env.DB.prepare("INSERT INTO organizations (id, name) VALUES (?, ?)")
      .bind("test", "Test Org")
      .run();
    await env.DB.prepare(
      "INSERT INTO locations (id, organization_id, name, abbrev) VALUES (?, ?, ?, ?)"
    )
      .bind("loc-1", "test", "Main Venue", "MV")
      .run();

    const loc = await env.DB.prepare(
      "SELECT name, abbrev FROM locations WHERE id = ? AND organization_id = ?"
    )
      .bind("loc-1", "test")
      .first<{ name: string; abbrev: string }>();

    expect(loc).toEqual({ name: "Main Venue", abbrev: "MV" });
  });
});
