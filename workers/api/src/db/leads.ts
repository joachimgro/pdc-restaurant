import type {
  GroupedLeads,
  Lead,
  LeadSummary,
  Message,
  TimelineEvent,
} from "@lead-intake/shared-types";
import type { Env } from "../env";
import { loadLeadNotes, insertLeadNote } from "./lead-notes";

export { insertLeadNote, loadLeadNotes };

/** Returns the current time as a human-readable label, e.g. "10:42 AM". */
export function nowTimeLabel(): string {
  return new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

type LeadRow = {
  id: string;
  organization_id: string;
  location_id: string | null;
  name: string;
  phone: string;
  time_label: string;
  status: string;
  status_label: string;
  assessment: string;
  preview: string;
  unread: number;
  source: string;
  interest: string;
  child_json: string | null;
  list_group: string;
  ai_paused: number;
  just_arrived: number;
  trial_slot: string | null;
  trial_slot_label: string | null;
  trial_proposed_json: string | null;
  trial_confirmed_at: string | null;
  location_confirmed: number;
};

type MessageRow = {
  id: string;
  kind: string;
  from_role: string | null;
  body: string | null;
  time_label: string | null;
  day_label: string | null;
  auto_followup_label: string | null;
  verdict: string | null;
  stage: string | null;
  note: string | null;
  staff_user_id: string | null;
  staff_author_name: string | null;
};

type TimelineRow = {
  time_label: string;
  parts_json: string;
};

const GROUP_ORDER = ["today", "yesterday", "this_week"] as const;

function mapGroup(g: string): keyof GroupedLeads["groups"] {
  if (g === "this_week") return "thisWeek";
  if (g === "yesterday") return "yesterday";
  return "today";
}

function rowToMessage(r: MessageRow): Message {
  if (r.kind === "day") return { kind: "day", day: r.day_label! };
  if (r.kind === "auto_followup")
    return { kind: "auto_followup", label: r.auto_followup_label! };
  const msg: Message = {
    kind: "chat",
    id: r.id,
    from: r.from_role as "lead" | "ai" | "staff",
    text: r.body!,
    time: r.time_label!,
  };
  if (r.staff_author_name) {
    msg.staffAuthorName = r.staff_author_name;
  }
  if (r.staff_user_id) {
    msg.staffUserId = r.staff_user_id;
  }
  if (r.verdict && r.stage && r.note) {
    msg.reasoning = { verdict: r.verdict, stage: r.stage, note: r.note };
  }
  return msg;
}

async function getLocationName(
  db: D1Database,
  locationId: string | null,
  orgId: string
): Promise<string> {
  if (!locationId) return "Unassigned";
  const row = await db
    .prepare("SELECT name FROM locations WHERE id = ? AND organization_id = ?")
    .bind(locationId, orgId)
    .first<{ name: string }>();
  return row?.name ?? locationId;
}

async function loadMessages(db: D1Database, leadId: string): Promise<Message[]> {
  const { results } = await db
    .prepare(
      `SELECT m.id, m.kind, m.from_role, m.body, m.time_label, m.day_label, m.auto_followup_label,
              m.staff_user_id, m.staff_author_name,
              r.verdict, r.stage, r.note
       FROM messages m
       LEFT JOIN message_reasoning r ON r.message_id = m.id
       WHERE m.lead_id = ?
       ORDER BY m.sort_order ASC`
    )
    .bind(leadId)
    .all<MessageRow>();
  return (results ?? []).map(rowToMessage);
}

async function loadTimeline(
  db: D1Database,
  leadId: string
): Promise<TimelineEvent[]> {
  const { results } = await db
    .prepare(
      `SELECT time_label, parts_json FROM timeline_events
       WHERE lead_id = ? ORDER BY sort_order ASC`
    )
    .bind(leadId)
    .all<TimelineRow>();
  return (results ?? []).map((r) => ({
    time: r.time_label,
    parts: JSON.parse(r.parts_json),
  }));
}

async function rowToLead(db: D1Database, row: LeadRow): Promise<Lead> {
  const location = await getLocationName(db, row.location_id, row.organization_id);
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    time: row.time_label,
    location,
    locationId: row.location_id ?? undefined,
    status: row.status as Lead["status"],
    statusLabel: row.status_label,
    assessment: row.assessment,
    preview: row.preview,
    unread: row.unread === 1,
    source: row.source,
    interest: row.interest,
    child: row.child_json ? JSON.parse(row.child_json) : undefined,
    trialSlot: row.trial_slot ?? undefined,
    trialSlotLabel: row.trial_slot_label ?? undefined,
    trialProposed: row.trial_proposed_json
      ? JSON.parse(row.trial_proposed_json)
      : undefined,
    trialConfirmedAt: row.trial_confirmed_at ?? undefined,
    locationConfirmed: row.location_confirmed !== 0,
    justArrived: row.just_arrived === 1,
    aiPaused: row.ai_paused === 1,
    notes: await loadLeadNotes(db, row.id),
    messages: await loadMessages(db, row.id),
    timeline: await loadTimeline(db, row.id),
  };
}

function rowToSummary(row: LeadRow, location: string): LeadSummary {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    time: row.time_label,
    location,
    status: row.status as LeadSummary["status"],
    statusLabel: row.status_label,
    assessment: row.assessment,
    preview: row.preview,
    unread: row.unread === 1,
    source: row.source,
    interest: row.interest,
    justArrived: row.just_arrived === 1,
  };
}

export async function listLeads(env: Env): Promise<GroupedLeads> {
  const { results } = await env.DB.prepare(
    `SELECT * FROM leads WHERE organization_id = ? ORDER BY list_group, sort_order`
  )
    .bind(env.ORGANIZATION_ID)
    .all<LeadRow>();

  const groups: GroupedLeads["groups"] = {
    today: [],
    yesterday: [],
    thisWeek: [],
  };
  const leads: Record<string, Lead> = {};

  for (const row of results ?? []) {
    const key = mapGroup(row.list_group);
    groups[key].push(row.id);
    leads[row.id] = await rowToLead(env.DB, row);
  }

  const activeCount = (results ?? []).length;

  return { activeCount, groups, leads };
}

export async function listLeadsSummaries(env: Env): Promise<{
  activeCount: number;
  groups: GroupedLeads["groups"];
  leads: Record<string, LeadSummary>;
}> {
  const { results } = await env.DB.prepare(
    `SELECT l.*, loc.name as location_name FROM leads l
     LEFT JOIN locations loc ON loc.id = l.location_id
     WHERE l.organization_id = ?
     ORDER BY l.list_group, l.sort_order`
  )
    .bind(env.ORGANIZATION_ID)
    .all<LeadRow & { location_name: string }>();

  const groups: GroupedLeads["groups"] = {
    today: [],
    yesterday: [],
    thisWeek: [],
  };
  const leads: Record<string, LeadSummary> = {};

  for (const row of results ?? []) {
    const key = mapGroup(row.list_group);
    groups[key].push(row.id);
    leads[row.id] = rowToSummary(row, row.location_name ?? "Unassigned");
  }

  return { activeCount: (results ?? []).length, groups, leads };
}

export async function getLead(env: Env, id: string): Promise<Lead | null> {
  const row = await env.DB.prepare(
    "SELECT * FROM leads WHERE id = ? AND organization_id = ?"
  )
    .bind(id, env.ORGANIZATION_ID)
    .first<LeadRow>();
  if (!row) return null;
  return rowToLead(env.DB, row);
}

export async function markLeadRead(env: Env, id: string): Promise<void> {
  await env.DB.prepare(
    `UPDATE leads SET unread = 0, updated_at = datetime('now') WHERE id = ?`
  )
    .bind(id)
    .run();
}

export async function setLeadJustArrived(
  env: Env,
  id: string,
  value: boolean
): Promise<void> {
  await env.DB.prepare(
    `UPDATE leads SET just_arrived = ?, updated_at = datetime('now') WHERE id = ?`
  )
    .bind(value ? 1 : 0, id)
    .run();
}

export type LeadFieldUpdates = Partial<{
  preview: string;
  assessment: string;
  status: string;
  statusLabel: string;
  unread: boolean;
  aiPaused: boolean;
  locationId: string;
  locationConfirmed: boolean;
  trialSlot: string | null;
  trialSlotLabel: string | null;
  trialProposedJson: string | null;
  trialConfirmedAt: string | null;
}>;

/**
 * Build the UPDATE statement for lead field changes without running it,
 * so it can be included in an atomic `env.DB.batch([...])`.
 */
export function buildLeadUpdateStatement(
  db: D1Database,
  id: string,
  fields: LeadFieldUpdates
): D1PreparedStatement {
  const sets: string[] = ["updated_at = datetime('now')"];
  const binds: unknown[] = [];

  if (fields.preview !== undefined) {
    sets.push("preview = ?");
    binds.push(fields.preview);
  }
  if (fields.assessment !== undefined) {
    sets.push("assessment = ?");
    binds.push(fields.assessment);
  }
  if (fields.status !== undefined) {
    sets.push("status = ?");
    binds.push(fields.status);
  }
  if (fields.statusLabel !== undefined) {
    sets.push("status_label = ?");
    binds.push(fields.statusLabel);
  }
  if (fields.unread !== undefined) {
    sets.push("unread = ?");
    binds.push(fields.unread ? 1 : 0);
  }
  if (fields.aiPaused !== undefined) {
    sets.push("ai_paused = ?");
    binds.push(fields.aiPaused ? 1 : 0);
  }
  if (fields.locationId !== undefined) {
    sets.push("location_id = ?");
    binds.push(fields.locationId);
  }
  if (fields.locationConfirmed !== undefined) {
    sets.push("location_confirmed = ?");
    binds.push(fields.locationConfirmed ? 1 : 0);
  }
  if (fields.trialSlot !== undefined) {
    sets.push("trial_slot = ?");
    binds.push(fields.trialSlot);
  }
  if (fields.trialSlotLabel !== undefined) {
    sets.push("trial_slot_label = ?");
    binds.push(fields.trialSlotLabel);
  }
  if (fields.trialProposedJson !== undefined) {
    sets.push("trial_proposed_json = ?");
    binds.push(fields.trialProposedJson);
  }
  if (fields.trialConfirmedAt !== undefined) {
    sets.push("trial_confirmed_at = ?");
    binds.push(fields.trialConfirmedAt);
  }

  binds.push(id);
  return db.prepare(`UPDATE leads SET ${sets.join(", ")} WHERE id = ?`).bind(...binds);
}

export async function updateLeadFields(
  env: Env,
  id: string,
  fields: LeadFieldUpdates
): Promise<void> {
  await buildLeadUpdateStatement(env.DB, id, fields).run();
}

/**
 * Build the INSERT statement(s) for a message without running them, so they
 * can be included in an atomic `env.DB.batch([...])`. Returns the generated
 * message id plus the ordered statements (chat messages with reasoning produce
 * two statements).
 */
export function buildMessageStatements(
  db: D1Database,
  leadId: string,
  sortOrder: number,
  message: Message
): { id: string; statements: D1PreparedStatement[] } {
  const id = crypto.randomUUID();

  if (message.kind === "day") {
    return {
      id,
      statements: [
        db
          .prepare(
            `INSERT INTO messages (id, lead_id, sort_order, kind, day_label)
             VALUES (?, ?, ?, 'day', ?)`
          )
          .bind(id, leadId, sortOrder, message.day),
      ],
    };
  }

  if (message.kind === "auto_followup") {
    return {
      id,
      statements: [
        db
          .prepare(
            `INSERT INTO messages (id, lead_id, sort_order, kind, auto_followup_label)
             VALUES (?, ?, ?, 'auto_followup', ?)`
          )
          .bind(id, leadId, sortOrder, message.label),
      ],
    };
  }

  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        `INSERT INTO messages (id, lead_id, sort_order, kind, from_role, body, time_label, staff_user_id, staff_author_name)
         VALUES (?, ?, ?, 'chat', ?, ?, ?, ?, ?)`
      )
      .bind(
        id,
        leadId,
        sortOrder,
        message.from,
        message.text,
        message.time,
        message.staffUserId ?? null,
        message.staffAuthorName ?? null
      ),
  ];

  if (message.reasoning) {
    statements.push(
      db
        .prepare(
          `INSERT INTO message_reasoning (message_id, verdict, stage, note)
           VALUES (?, ?, ?, ?)`
        )
        .bind(
          id,
          message.reasoning.verdict,
          message.reasoning.stage,
          message.reasoning.note
        )
    );
  }

  return { id, statements };
}

export async function insertMessage(
  db: D1Database,
  leadId: string,
  sortOrder: number,
  message: Message
): Promise<string> {
  const { id, statements } = buildMessageStatements(db, leadId, sortOrder, message);
  for (const s of statements) await s.run();
  return id;
}

export async function nextMessageSortOrder(
  db: D1Database,
  leadId: string
): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COALESCE(MAX(sort_order), -1) + 1 as n FROM messages WHERE lead_id = ?`
    )
    .bind(leadId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

export async function leadExists(
  db: D1Database,
  id: string
): Promise<boolean> {
  const row = await db
    .prepare("SELECT 1 FROM leads WHERE id = ?")
    .bind(id)
    .first();
  return !!row;
}

/** Deletes lead and all cascaded messages, reasoning, timeline */
export async function deleteLead(env: Env, id: string): Promise<boolean> {
  if (!(await leadExists(env.DB, id))) return false;

  await env.DB.prepare(
    `DELETE FROM leads WHERE id = ? AND organization_id = ?`
  )
    .bind(id, env.ORGANIZATION_ID)
    .run();

  return true;
}

export async function countLeads(db: D1Database, orgId: string): Promise<number> {
  const row = await db
    .prepare("SELECT COUNT(*) as c FROM leads WHERE organization_id = ?")
    .bind(orgId)
    .first<{ c: number }>();
  return row?.c ?? 0;
}

export { GROUP_ORDER };
