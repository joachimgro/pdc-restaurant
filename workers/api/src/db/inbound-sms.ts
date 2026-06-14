import { insertDomainEvent } from "./events";
import {
  getLead,
  insertMessage,
  nextMessageSortOrder,
  nowTimeLabel,
  updateLeadFields,
} from "./leads";
import { getDefaultLocation } from "./locations";
import type { Env } from "../env";
import { canonicalPhone, phoneDigitSuffix } from "./phone-utils";

export interface InboundSmsInput {
  phone: string;
  text: string;
  externalId: string;
  provider: "twilio" | "telnyx";
  source?: string;
  displayName?: string;
  locationId?: string;
}

export interface InboundSmsResult {
  leadId: string;
  isNew: boolean;
  messageId: string;
  skipped?: boolean;
}

export async function processInboundSms(
  env: Env,
  input: InboundSmsInput
): Promise<InboundSmsResult> {
  const phone = canonicalPhone(input.phone);
  const text = input.text.trim();
  const source = input.source ?? "SMS";

  let locationId: string | null = input.locationId ?? null;
  let locationConfirmed = !!input.locationId;

  if (!locationId) {
    const defaultLocation = await getDefaultLocation(env);
    if (defaultLocation) {
      locationId = defaultLocation.id;
      locationConfirmed = false;
    } else {
      console.warn(
        `Inbound SMS from ${phone} — no locations configured for org ${env.ORGANIZATION_ID}. Lead created without location.`
      );
    }
  }

  if (!phone || !text) {
    return {
      leadId: "",
      isNew: false,
      messageId: "",
      skipped: true,
    };
  }

  const dup = await env.DB.prepare(
    `SELECT 1 FROM webhook_deliveries WHERE provider = ? AND external_id = ?`
  )
    .bind(input.provider, input.externalId)
    .first();

  if (dup) {
    const existing = await env.DB.prepare(
      `SELECT id FROM leads WHERE phone = ? AND organization_id = ?`
    )
      .bind(phone, env.ORGANIZATION_ID)
      .first<{ id: string }>() ?? await env.DB.prepare(
        `SELECT id FROM leads
         WHERE organization_id = ?
           AND replace(replace(replace(replace(phone,' ',''),'-',''),'.',''),'()','') LIKE ?
         LIMIT 1`
      ).bind(env.ORGANIZATION_ID, `%${phoneDigitSuffix(phone)}`).first<{ id: string }>();
    return {
      leadId: existing?.id ?? "",
      isNew: false,
      messageId: "",
      skipped: true,
    };
  }

  await env.DB.prepare(
    `INSERT INTO webhook_deliveries (id, provider, external_id) VALUES (?, ?, ?)`
  )
    .bind(crypto.randomUUID(), input.provider, input.externalId)
    .run();

  const preview =
    text.length > 56 ? text.slice(0, 53) + "..." : text;

  let existing = await env.DB.prepare(
    `SELECT id FROM leads WHERE phone = ? AND organization_id = ?`
  )
    .bind(phone, env.ORGANIZATION_ID)
    .first<{ id: string }>();

  if (!existing) {
    const suffix = phoneDigitSuffix(phone);
    if (suffix.length >= 9) {
      existing = await env.DB.prepare(
        `SELECT id FROM leads
         WHERE organization_id = ?
           AND replace(replace(replace(replace(phone,' ',''),'-',''),'.',''),'()','') LIKE ?
         LIMIT 1`
      )
        .bind(env.ORGANIZATION_ID, `%${suffix}`)
        .first<{ id: string }>();

      if (existing) {
        await env.DB.prepare(
          `UPDATE leads SET phone = ?, updated_at = datetime('now') WHERE id = ?`
        )
          .bind(phone, existing.id)
          .run();
      }
    }
  }

  if (existing) {
    const leadId = existing.id;
    const sortOrder = await nextMessageSortOrder(env.DB, leadId);

    const hasDay = await env.DB.prepare(
      `SELECT 1 FROM messages WHERE lead_id = ? AND kind = 'day' LIMIT 1`
    )
      .bind(leadId)
      .first();

    let order = sortOrder;
    if (!hasDay) {
      await insertMessage(env.DB, leadId, order++, {
        kind: "day",
        day: "Today, just now",
      });
    }

    const msgTime = nowTimeLabel();
    const messageId = await insertMessage(env.DB, leadId, order, {
      kind: "chat",
      from: "lead",
      text,
      time: msgTime,
    });

    await updateLeadFields(env, leadId, {
      preview,
      unread: true,
      assessment: "New message — AI responding",
    });

    const lead = await getLead(env, leadId);
    if (lead) {
      await insertDomainEvent(env.DB, env.ORGANIZATION_ID, {
        type: "message.created",
        payload: {
          leadId,
          message: {
            kind: "chat",
            id: messageId,
            from: "lead",
            text,
            time: msgTime,
          },
        },
      });
      await insertDomainEvent(env.DB, env.ORGANIZATION_ID, {
        type: "lead.updated",
        payload: { leadId, patch: { preview, unread: true } },
      });
    }

    return { leadId, isNew: false, messageId };
  }

  const leadId = crypto.randomUUID();
  const displayName = input.displayName?.trim() || phone;

  // INSERT OR IGNORE handles the race where two concurrent requests both pass
  // the SELECT-first lookup above and attempt to insert the same phone number.
  // The UNIQUE INDEX idx_leads_org_phone (added in migration 0017) ensures only
  // one insert succeeds; the second is silently ignored and we fall through to
  // re-lookup the winner below.
  await env.DB.prepare(
    `INSERT OR IGNORE INTO leads (
      id, organization_id, location_id, name, phone, time_label,
      status, status_label, assessment, preview, unread, source, interest,
      list_group, sort_order, just_arrived, location_confirmed
    ) VALUES (?, ?, ?, ?, ?, ?, 'new', 'New', 'New inbound SMS', ?, 1, ?, 'Unknown', 'today', 0, 1, ?)`
  )
    .bind(
      leadId,
      env.ORGANIZATION_ID,
      locationId,
      displayName,
      phone,
      nowTimeLabel(),
      preview,
      source,
      locationConfirmed ? 1 : 0
    )
    .run();

  // If a concurrent insert won the race, our INSERT was ignored. Re-check.
  const winner = await env.DB.prepare(
    `SELECT id FROM leads WHERE phone = ? AND organization_id = ?`
  )
    .bind(phone, env.ORGANIZATION_ID)
    .first<{ id: string }>();

  if (winner && winner.id !== leadId) {
    // Another request already created this lead — treat as existing
    console.warn(
      `Inbound SMS race: lead already exists for ${phone} in org ${env.ORGANIZATION_ID}. Routing to existing lead ${winner.id}.`
    );
    const sortOrder = await nextMessageSortOrder(env.DB, winner.id);
    const msgTime = nowTimeLabel();
    const messageId = await insertMessage(env.DB, winner.id, sortOrder, {
      kind: "chat",
      from: "lead",
      text,
      time: msgTime,
    });
    await updateLeadFields(env, winner.id, { preview, unread: true });
    return { leadId: winner.id, isNew: false, messageId };
  }

  const now = nowTimeLabel();
  await env.DB.prepare(
    `INSERT INTO timeline_events (id, lead_id, sort_order, time_label, parts_json)
     VALUES (?, ?, 0, ?, ?)`
  )
    .bind(
      crypto.randomUUID(),
      leadId,
      now,
      JSON.stringify([{ bold: "New lead", text: ` · ${source}` }])
    )
    .run();

  await insertMessage(env.DB, leadId, 0, {
    kind: "day",
    day: "Today, just now",
  });

  const messageId = await insertMessage(env.DB, leadId, 1, {
    kind: "chat",
    from: "lead",
    text,
    time: now,
  });

  const lead = await getLead(env, leadId);
  if (lead) {
    await insertDomainEvent(env.DB, env.ORGANIZATION_ID, {
      type: "lead.created",
      payload: { lead },
    });
  }

  return { leadId, isNew: true, messageId };
}

export async function queueInboundAi(
  env: Env,
  leadId: string,
  messageId: string
): Promise<void> {
  await env.AI_QUEUE.send({
    type: "process_inbound",
    leadId,
    messageId,
  });
}
