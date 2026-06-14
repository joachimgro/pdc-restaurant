import type { LeadNote } from "@lead-intake/shared-types";

type LeadNoteRow = {
  id: string;
  lead_id: string;
  author_name: string;
  author_user_id: string | null;
  body: string;
  created_at: string;
};

function rowToLeadNote(r: LeadNoteRow): LeadNote {
  return {
    id: r.id,
    body: r.body,
    authorName: r.author_name,
    createdAt: r.created_at,
    authorUserId: r.author_user_id ?? undefined,
  };
}

export async function loadLeadNotes(
  db: D1Database,
  leadId: string
): Promise<LeadNote[]> {
  const { results } = await db
    .prepare(
      `SELECT id, lead_id, author_name, author_user_id, body, created_at
       FROM lead_notes WHERE lead_id = ? ORDER BY created_at ASC`
    )
    .bind(leadId)
    .all<LeadNoteRow>();
  return (results ?? []).map(rowToLeadNote);
}

export async function insertLeadNote(
  db: D1Database,
  leadId: string,
  body: string,
  authorName: string,
  authorUserId?: string
): Promise<LeadNote> {
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();

  await db
    .prepare(
      `INSERT INTO lead_notes (id, lead_id, author_name, author_user_id, body, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .bind(id, leadId, authorName, authorUserId ?? null, body, createdAt)
    .run();

  return {
    id,
    body,
    authorName,
    createdAt,
    authorUserId,
  };
}
