import {
  buildSeedLeads,
  LEAD_GROUPS,
  LOCATIONS,
} from "@lead-intake/seed-data";
import type { Lead, Message } from "@lead-intake/shared-types";
import type { Env } from "../env";
import { countLeads } from "./leads";

// TODO: update the org name to match the client (used in DB only; display name comes from ai_config)
const ORG_NAME = "TODO: Client Name";

function groupKeyForLeadId(id: string): string {
  if ((LEAD_GROUPS.today as readonly string[]).includes(id)) return "today";
  if ((LEAD_GROUPS.yesterday as readonly string[]).includes(id))
    return "yesterday";
  return "this_week";
}

async function insertLead(
  db: D1Database,
  orgId: string,
  lead: Lead,
  sortOrder: number
): Promise<void> {
  const listGroup = groupKeyForLeadId(lead.id);

  await db
    .prepare(
      `INSERT INTO leads (
        id, organization_id, location_id, name, phone, time_label,
        status, status_label, assessment, preview, unread, source, interest,
        child_json, list_group, sort_order, ai_paused, just_arrived
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0)`
    )
    .bind(
      lead.id,
      orgId,
      lead.locationId ?? lead.location.toLowerCase(),
      lead.name,
      lead.phone,
      lead.time,
      lead.status,
      lead.statusLabel,
      lead.assessment,
      lead.preview,
      lead.unread ? 1 : 0,
      lead.source,
      lead.interest,
      lead.child ? JSON.stringify(lead.child) : null,
      listGroup,
      sortOrder
    )
    .run();

  let msgOrder = 0;
  for (const msg of lead.messages) {
    await insertMessageSeed(db, lead.id, msgOrder++, msg);
  }

  let tlOrder = 0;
  for (const ev of lead.timeline) {
    await db
      .prepare(
        `INSERT INTO timeline_events (id, lead_id, sort_order, time_label, parts_json)
         VALUES (?, ?, ?, ?, ?)`
      )
      .bind(
        crypto.randomUUID(),
        lead.id,
        tlOrder++,
        ev.time,
        JSON.stringify(ev.parts)
      )
      .run();
  }
}

async function insertMessageSeed(
  db: D1Database,
  leadId: string,
  sortOrder: number,
  message: Message
): Promise<void> {
  const id = crypto.randomUUID();

  if (message.kind === "day") {
    await db
      .prepare(
        `INSERT INTO messages (id, lead_id, sort_order, kind, day_label) VALUES (?, ?, ?, 'day', ?)`
      )
      .bind(id, leadId, sortOrder, message.day)
      .run();
    return;
  }

  if (message.kind === "auto_followup") {
    await db
      .prepare(
        `INSERT INTO messages (id, lead_id, sort_order, kind, auto_followup_label) VALUES (?, ?, ?, 'auto_followup', ?)`
      )
      .bind(id, leadId, sortOrder, message.label)
      .run();
    return;
  }

  await db
    .prepare(
      `INSERT INTO messages (id, lead_id, sort_order, kind, from_role, body, time_label) VALUES (?, ?, ?, 'chat', ?, ?, ?)`
    )
    .bind(id, leadId, sortOrder, message.from, message.text, message.time)
    .run();

  if (message.reasoning) {
    await db
      .prepare(
        `INSERT INTO message_reasoning (message_id, verdict, stage, note) VALUES (?, ?, ?, ?)`
      )
      .bind(
        id,
        message.reasoning.verdict,
        message.reasoning.stage,
        message.reasoning.note
      )
      .run();
  }
}

export async function seedDatabase(env: Env): Promise<{ seeded: boolean; count: number }> {
  const existing = await countLeads(env.DB, env.ORGANIZATION_ID);
  if (existing > 0) {
    return { seeded: false, count: existing };
  }

  await env.DB.prepare(
    `INSERT INTO organizations (id, name) VALUES (?, ?)`
  )
    .bind(env.ORGANIZATION_ID, ORG_NAME)
    .run();

  for (const loc of LOCATIONS) {
    await env.DB.prepare(
      `INSERT INTO locations (id, organization_id, name, abbrev, badge_count) VALUES (?, ?, ?, ?, ?)`
    )
      .bind(
        loc.id,
        env.ORGANIZATION_ID,
        loc.name,
        loc.abbrev,
        loc.badge ?? null
      )
      .run();
  }

  const leads = buildSeedLeads();
  const order = [
    ...LEAD_GROUPS.today,
    ...LEAD_GROUPS.yesterday,
    ...LEAD_GROUPS.thisWeek,
  ];

  let i = 0;
  for (const id of order) {
    const lead = leads[id];
    if (lead) await insertLead(env.DB, env.ORGANIZATION_ID, lead, i++);
  }

  return { seeded: true, count: order.length };
}
