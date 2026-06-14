import type { IntakeFormInput } from "@lead-intake/shared-types";
import { buildIntakePreview } from "../ai/intake-context";
import { insertDomainEvent } from "./events";
import {
  getLead,
  insertMessage,
  nowTimeLabel,
  updateLeadFields,
} from "./leads";
import type { Env } from "../env";
import { canonicalPhone } from "./phone-utils";

export interface InboundLeadResult {
  leadId: string;
  isNew: boolean;
}

export async function createInboundFromIntake(
  env: Env,
  input: IntakeFormInput
): Promise<InboundLeadResult> {
  const locationRow = await env.DB.prepare(
    `SELECT name FROM locations WHERE id = ? AND organization_id = ?`
  )
    .bind(input.locationId, env.ORGANIZATION_ID)
    .first<{ name: string }>();

  if (!locationRow) {
    throw new Error("Unknown academy — please choose a valid location");
  }

  const locationName = locationRow.name;
  const preview = buildIntakePreview(input.interest, locationName);

  const child =
    input.childName && input.childName.trim()
      ? {
          name: input.childName.trim(),
          age: input.childAge
            ? Number.isNaN(Number(input.childAge))
              ? String(input.childAge)
              : Number(input.childAge)
            : "—",
          experience: input.experience || "First-timer",
        }
      : undefined;

  const phone = canonicalPhone(input.phone);

  const existing = await env.DB.prepare(
    `SELECT id FROM leads WHERE phone = ? AND organization_id = ?`
  )
    .bind(phone, env.ORGANIZATION_ID)
    .first<{ id: string }>();

  if (existing) {
    const leadId = existing.id;

    await updateLeadFields(env, leadId, {
      preview,
      unread: true,
      assessment: "Form updated — AI welcoming",
    });

    await env.DB.prepare(
      `UPDATE leads SET
         location_id = ?,
         interest = ?,
         location_confirmed = 1,
         child_json = COALESCE(?, child_json),
         updated_at = datetime('now')
       WHERE id = ?`
    )
      .bind(
        input.locationId,
        input.interest,
        child ? JSON.stringify(child) : null,
        leadId
      )
      .run();

    const lead = await getLead(env, leadId);
    if (lead) {
      await insertDomainEvent(env.DB, env.ORGANIZATION_ID, {
        type: "lead.updated",
        payload: {
          leadId,
          patch: { preview, unread: true, interest: input.interest },
        },
      });
    }

    return { leadId, isNew: false };
  }

  const leadId = crypto.randomUUID();
  const childJson = child ? JSON.stringify(child) : null;

  await env.DB.prepare(
    `INSERT INTO leads (
      id, organization_id, location_id, name, phone, time_label,
      status, status_label, assessment, preview, unread, source, interest,
      location_confirmed, child_json, list_group, sort_order, just_arrived
    ) VALUES (?, ?, ?, ?, ?, ?, 'new', 'New', ?, ?, 1, 'Website', ?, 1, ?, 'today', 0, 1)`
  )
    .bind(
      leadId,
      env.ORGANIZATION_ID,
      input.locationId,
      input.name.trim(),
      phone,
      nowTimeLabel(),
      "New enquiry — sending welcome",
      preview,
      input.interest,
      childJson
    )
    .run();

  const now = nowTimeLabel();
  const timelineParts = [
    { bold: "New lead", text: ` · Website form · ${input.interest}` },
  ];
  if (child) {
    await env.DB.prepare(
      `INSERT INTO timeline_events (id, lead_id, sort_order, time_label, parts_json)
       VALUES (?, ?, 1, ?, ?)`
    )
      .bind(
        crypto.randomUUID(),
        leadId,
        now,
        JSON.stringify([{ text: `Child: ${child.name}, age ${child.age}` }])
      )
      .run();
  }

  await env.DB.prepare(
    `INSERT INTO timeline_events (id, lead_id, sort_order, time_label, parts_json)
     VALUES (?, ?, 0, ?, ?)`
  )
    .bind(crypto.randomUUID(), leadId, now, JSON.stringify(timelineParts))
    .run();

  await insertMessage(env.DB, leadId, 0, {
    kind: "day",
    day: "Today, just now",
  });

  const lead = await getLead(env, leadId);
  if (lead) {
    await insertDomainEvent(env.DB, env.ORGANIZATION_ID, {
      type: "lead.created",
      payload: { lead },
    });
  }

  return { leadId, isNew: true };
}
