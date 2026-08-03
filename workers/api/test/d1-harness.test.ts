import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { EXPECTED_SCHEMA_VERSION } from "../src/meta";

// Proves the vitest-pool-workers harness: real D1 with the full migration
// chain applied by test/apply-migrations.ts.
describe("D1 test harness", () => {
  it("applies the migration chain to the test database", async () => {
    const row = await env.DB.prepare(
      "SELECT value FROM _meta WHERE key = 'schema_version'"
    ).first<{ value: string }>();
    expect(row?.value).toBe(EXPECTED_SCHEMA_VERSION);
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

  it("schema_version writes are monotonic (numbering-gap guard)", async () => {
    // The reserved gap 0023-0033 may be applied AFTER 0034+ on a client fork.
    // A guarded write must never lower the version — otherwise the schema
    // gate would 503 all traffic. Simulate: version already ahead at '0035',
    // then re-run 0034's version write verbatim.
    await env.DB.prepare(
      "UPDATE _meta SET value = '0035' WHERE key = 'schema_version'"
    ).run();

    await env.DB.prepare(
      "UPDATE _meta SET value = '0034', updated_at = datetime('now') WHERE key = 'schema_version' AND value < '0034'"
    ).run();

    const row = await env.DB.prepare(
      "SELECT value FROM _meta WHERE key = 'schema_version'"
    ).first<{ value: string }>();
    expect(row?.value).toBe("0035");
  });
});
