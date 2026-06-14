import type { DomainEvent } from "@lead-intake/shared-types";
import type { Env } from "../env";

/**
 * Build the prepared statement for a domain event without running it.
 * Lets callers include event writes inside an atomic `env.DB.batch([...])`.
 */
export function domainEventStatement(
  db: D1Database,
  orgId: string,
  event: Omit<DomainEvent, "id" | "createdAt"> & { id?: string }
): { statement: D1PreparedStatement; full: DomainEvent } {
  const id = event.id ?? crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const full = { ...event, id, createdAt } as DomainEvent;

  const statement = db
    .prepare(
      `INSERT INTO domain_events (id, organization_id, type, payload_json, created_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    .bind(id, orgId, full.type, JSON.stringify(full), createdAt);

  return { statement, full };
}

export async function insertDomainEvent(
  db: D1Database,
  orgId: string,
  event: Omit<DomainEvent, "id" | "createdAt"> & { id?: string }
): Promise<DomainEvent> {
  const { statement, full } = domainEventStatement(db, orgId, event);
  await statement.run();
  return full;
}

/** Latest domain event id for this org (skip backlog on new SSE connections). */
export async function getLatestEventCursor(
  db: D1Database,
  orgId: string
): Promise<string | null> {
  const row = await db
    .prepare(
      `SELECT id FROM domain_events
       WHERE organization_id = ?
       ORDER BY created_at DESC
       LIMIT 1`
    )
    .bind(orgId)
    .first<{ id: string }>();
  return row?.id ?? null;
}

export async function fetchEventsSince(
  db: D1Database,
  orgId: string,
  cursor: string | null,
  limit = 50
): Promise<DomainEvent[]> {
  const query = cursor
    ? `SELECT payload_json FROM domain_events
       WHERE organization_id = ? AND created_at > (
         SELECT created_at FROM domain_events WHERE id = ?
       )
       ORDER BY created_at ASC LIMIT ?`
    : `SELECT payload_json FROM domain_events
       WHERE organization_id = ?
       ORDER BY created_at ASC LIMIT ?`;

  const stmt = cursor
    ? db.prepare(query).bind(orgId, cursor, limit)
    : db.prepare(query).bind(orgId, limit);

  const { results } = await stmt.all<{ payload_json: string }>();
  return (results ?? []).map((r) => JSON.parse(r.payload_json) as DomainEvent);
}
