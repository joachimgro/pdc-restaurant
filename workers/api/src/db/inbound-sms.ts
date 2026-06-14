import { domainEventStatement, insertDomainEvent } from "./events";
import {
  buildLeadUpdateStatement,
  buildMessageStatements,
  getLead,
  nextMessageSortOrder,
  nowTimeLabel,
} from "./leads";
import { getDefaultLocation } from "./locations";
import {
  deleteWebhookDelivery,
  recordWebhookDelivery,
} from "./webhook-deliveries";
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

  // Channel-agnostic idempotency gate (INSERT OR IGNORE — no SELECT-then-INSERT race).
  const { isDuplicate } = await recordWebhookDelivery(
    env,
    input.provider,
    input.externalId
  );

  if (isDuplicate) {
    console.warn(
      `[${env.ORGANIZATION_ID}] Duplicate webhook ${input.provider}:${input.externalId} — skipping`
    );
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

    const msgTime = nowTimeLabel();

    // Atomic group: optional day divider + inbound message + lead update + events.
    const statements: D1PreparedStatement[] = [];
    let order = sortOrder;
    if (!hasDay) {
      const day = buildMessageStatements(env.DB, leadId, order++, {
        kind: "day",
        day: "Today, just now",
      });
      statements.push(...day.statements);
    }

    const chat = buildMessageStatements(env.DB, leadId, order, {
      kind: "chat",
      from: "lead",
      text,
      time: msgTime,
    });
    const messageId = chat.id;
    statements.push(...chat.statements);

    statements.push(
      buildLeadUpdateStatement(env.DB, leadId, {
        preview,
        unread: true,
        assessment: "New message — AI responding",
      })
    );
    statements.push(
      domainEventStatement(env.DB, env.ORGANIZATION_ID, {
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
      }).statement
    );
    statements.push(
      domainEventStatement(env.DB, env.ORGANIZATION_ID, {
        type: "lead.updated",
        payload: { leadId, patch: { preview, unread: true } },
      }).statement
    );

    try {
      await env.DB.batch(statements);
    } catch (e) {
      // Un-record the delivery so the provider's retry re-processes cleanly.
      await deleteWebhookDelivery(env, input.provider, input.externalId).catch(
        () => {}
      );
      throw e;
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
    // Another request already created this lead — treat as existing.
    console.warn(
      `Inbound SMS race: lead already exists for ${phone} in org ${env.ORGANIZATION_ID}. Routing to existing lead ${winner.id}.`
    );
    const sortOrder = await nextMessageSortOrder(env.DB, winner.id);
    const msgTime = nowTimeLabel();
    const chat = buildMessageStatements(env.DB, winner.id, sortOrder, {
      kind: "chat",
      from: "lead",
      text,
      time: msgTime,
    });
    try {
      await env.DB.batch([
        ...chat.statements,
        buildLeadUpdateStatement(env.DB, winner.id, { preview, unread: true }),
      ]);
    } catch (e) {
      await deleteWebhookDelivery(env, input.provider, input.externalId).catch(
        () => {}
      );
      throw e;
    }
    return { leadId: winner.id, isNew: false, messageId: chat.id };
  }

  // We won (or are the sole creator). The lead row is already committed above
  // (needed for the race check); now write its initial content atomically.
  const now = nowTimeLabel();
  const day = buildMessageStatements(env.DB, leadId, 0, {
    kind: "day",
    day: "Today, just now",
  });
  const chat = buildMessageStatements(env.DB, leadId, 1, {
    kind: "chat",
    from: "lead",
    text,
    time: now,
  });
  const messageId = chat.id;

  try {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO timeline_events (id, lead_id, sort_order, time_label, parts_json)
         VALUES (?, ?, 0, ?, ?)`
      ).bind(
        crypto.randomUUID(),
        leadId,
        now,
        JSON.stringify([{ bold: "New lead", text: ` · ${source}` }])
      ),
      ...day.statements,
      ...chat.statements,
    ]);
  } catch (e) {
    // Roll back the standalone lead row + delivery so the retry starts clean.
    await env.DB.prepare(
      `DELETE FROM leads WHERE id = ? AND organization_id = ?`
    )
      .bind(leadId, env.ORGANIZATION_ID)
      .run()
      .catch(() => {});
    await deleteWebhookDelivery(env, input.provider, input.externalId).catch(
      () => {}
    );
    throw e;
  }

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
