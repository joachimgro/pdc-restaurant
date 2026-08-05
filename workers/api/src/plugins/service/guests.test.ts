import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Env } from "../../env";
import { resetContactsProbe, resolveGuest } from "./guests";

/** The test runtime provides DB and KV but not every binding in Env; the
 *  guest adapter only ever touches DB and ORGANIZATION_ID. */
const testEnv = env as unknown as Env;

/**
 * This fork has no CRM tables, so the absent path is the real one here. The
 * present path is exercised by creating the two tables inside a test: storage
 * is isolated per test file, so they do not leak.
 */

async function createCrmTables(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS contacts (
         id TEXT PRIMARY KEY,
         organization_id TEXT NOT NULL,
         display_name TEXT
       )`
    ),
    env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS contact_identifiers (
         id TEXT PRIMARY KEY,
         contact_id TEXT NOT NULL,
         organization_id TEXT NOT NULL,
         type TEXT NOT NULL,
         value TEXT NOT NULL,
         label TEXT,
         is_primary INTEGER NOT NULL DEFAULT 0,
         created_at TEXT NOT NULL DEFAULT (datetime('now')),
         UNIQUE(organization_id, type, value)
       )`
    ),
  ]);
}

async function dropCrmTables(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(`DROP TABLE IF EXISTS contact_identifiers`),
    env.DB.prepare(`DROP TABLE IF EXISTS contacts`),
  ]);
}

async function seedContact(
  contactId: string,
  identifiers: { type: string; value: string }[]
): Promise<void> {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO contacts (id, organization_id, display_name)
     VALUES (?, ?, ?)`
  )
    .bind(contactId, env.ORGANIZATION_ID, "Test Guest")
    .run();

  for (const ident of identifiers) {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO contact_identifiers
         (id, contact_id, organization_id, type, value)
       VALUES (?, ?, ?, ?, ?)`
    )
      .bind(
        crypto.randomUUID(),
        contactId,
        env.ORGANIZATION_ID,
        ident.type,
        ident.value
      )
      .run();
  }
}

beforeEach(() => {
  resetContactsProbe();
});

afterEach(async () => {
  await dropCrmTables();
  resetContactsProbe();
});

describe("resolveGuest — no CRM tables (this fork)", () => {
  it("returns a null contactId rather than throwing", async () => {
    const result = await resolveGuest(testEnv, {
      name: "Sarah Jones",
      phone: "+447700900123",
      email: "sarah@example.com",
    });
    expect(result).toEqual({ contactId: null });
  });

  it("probes sqlite_master once per isolate, not once per call", async () => {
    const original = env.DB.prepare.bind(env.DB);
    let probes = 0;
    env.DB.prepare = (sql: string) => {
      if (sql.includes("sqlite_master")) probes++;
      return original(sql);
    };

    try {
      for (let i = 0; i < 5; i++) {
        await resolveGuest(testEnv, { name: "Repeat", phone: "+447700900999" });
      }
    } finally {
      env.DB.prepare = original;
    }

    expect(probes).toBe(1);
  });

  it("does not query for a guest with neither phone nor email", async () => {
    const result = await resolveGuest(testEnv, {
      name: "Walk-in",
      phone: null,
      email: null,
    });
    expect(result).toEqual({ contactId: null });
  });
});

describe("resolveGuest — CRM tables present", () => {
  beforeEach(async () => {
    await createCrmTables();
    resetContactsProbe();
  });

  it("finds a contact by exact phone", async () => {
    await seedContact("contact-1", [
      { type: "phone", value: "+447700900123" },
    ]);

    const result = await resolveGuest(testEnv, {
      name: "Sarah Jones",
      phone: "+447700900123",
    });
    expect(result).toEqual({ contactId: "contact-1" });
  });

  it("normalises a local-format phone the same way the CRM stored it", async () => {
    // Stored canonical, supplied as a guest would type it.
    await seedContact("contact-2", [
      { type: "phone", value: "+447700900123" },
    ]);

    const result = await resolveGuest(testEnv, {
      name: "Sarah Jones",
      phone: "07700 900123",
    });
    expect(result).toEqual({ contactId: "contact-2" });
  });

  it("matches email case-insensitively", async () => {
    await seedContact("contact-3", [
      { type: "email", value: "sarah@example.com" },
    ]);

    const result = await resolveGuest(testEnv, {
      name: "Sarah Jones",
      email: "Sarah@Example.COM",
    });
    expect(result).toEqual({ contactId: "contact-3" });
  });

  it("prefers phone over email when both match different contacts", async () => {
    await seedContact("contact-phone", [
      { type: "phone", value: "+447700900123" },
    ]);
    await seedContact("contact-email", [
      { type: "email", value: "shared@example.com" },
    ]);

    const result = await resolveGuest(testEnv, {
      name: "Sarah Jones",
      phone: "+447700900123",
      email: "shared@example.com",
    });
    expect(result).toEqual({ contactId: "contact-phone" });
  });

  it("falls back to email when the phone does not match", async () => {
    await seedContact("contact-4", [
      { type: "email", value: "sarah@example.com" },
    ]);

    const result = await resolveGuest(testEnv, {
      name: "Sarah Jones",
      phone: "+447700900999",
      email: "sarah@example.com",
    });
    expect(result).toEqual({ contactId: "contact-4" });
  });

  it("returns null when nothing matches", async () => {
    await seedContact("contact-5", [
      { type: "phone", value: "+447700900123" },
    ]);

    const result = await resolveGuest(testEnv, {
      name: "Nobody",
      phone: "+447700900555",
      email: "nobody@example.com",
    });
    expect(result).toEqual({ contactId: null });
  });

  it("ignores an identifier belonging to another organisation", async () => {
    await env.DB.prepare(
      `INSERT INTO contacts (id, organization_id, display_name)
       VALUES ('other-org-contact', 'some-other-org', 'Other Org')`
    ).run();
    await env.DB.prepare(
      `INSERT INTO contact_identifiers (id, contact_id, organization_id, type, value)
       VALUES ('oi-1', 'other-org-contact', 'some-other-org', 'phone', '+447700900123')`
    ).run();

    const result = await resolveGuest(testEnv, {
      name: "Sarah Jones",
      phone: "+447700900123",
    });
    expect(result).toEqual({ contactId: null });
  });
});

describe("resolveGuest — degraded CRM schema", () => {
  it("returns null instead of throwing when the schema has drifted", async () => {
    // Both table names exist so the probe passes, but the columns the lookup
    // needs are missing — a plausible state on a partially migrated fork.
    await env.DB.batch([
      env.DB.prepare(`CREATE TABLE contacts (id TEXT PRIMARY KEY)`),
      env.DB.prepare(`CREATE TABLE contact_identifiers (id TEXT PRIMARY KEY)`),
    ]);
    resetContactsProbe();

    const result = await resolveGuest(testEnv, {
      name: "Sarah Jones",
      phone: "+447700900123",
    });
    expect(result).toEqual({ contactId: null });
  });
});
