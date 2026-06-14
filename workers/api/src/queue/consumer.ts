import type { Message as ChatMessage } from "@lead-intake/shared-types";
import { insertDomainEvent } from "../db/events";
import {
  getLead,
  insertMessage,
  nextMessageSortOrder,
  nowTimeLabel,
  updateLeadFields,
} from "../db/leads";
import {
  buildWebsiteIntakePrompt,
  pickScheduleLine,
} from "../ai/intake-context";
import { ragEnabled, retrieveKnowledge, buildRagQuery } from "../ai/rag";
import { loadScheduleForLead } from "../schedule-runtime";
import { generateAiReply } from "../ai/pipeline";
import type { Lead } from "@lead-intake/shared-types";
import { sendTwilioSms, twilioConfigured } from "../twilio/send";
import type { Env, QueueMessage } from "../env";

const MAX_ATTEMPTS = 3;

// ─── Send-lock helpers ────────────────────────────────────────────────────────
// Prevents duplicate outbound SMS when the consumer retries after a
// post-send D1 write failure.  See migration 0016.

async function checkSendLock(
  env: Env,
  queueMsgId: string
): Promise<{ exists: boolean; smsSent: boolean }> {
  const row = await env.DB.prepare(
    "SELECT sms_sent_at FROM queue_processing_locks WHERE queue_message_id = ?"
  )
    .bind(queueMsgId)
    .first<{ sms_sent_at: string | null }>();

  return {
    exists: row !== null,
    smsSent: !!row?.sms_sent_at,
  };
}

async function insertSendLock(
  env: Env,
  queueMsgId: string,
  leadId: string
): Promise<void> {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO queue_processing_locks (queue_message_id, lead_id, created_at)
     VALUES (?, ?, datetime('now'))`
  )
    .bind(queueMsgId, leadId)
    .run();
}

async function markSmsSent(env: Env, queueMsgId: string): Promise<void> {
  await env.DB.prepare(
    "UPDATE queue_processing_locks SET sms_sent_at = datetime('now') WHERE queue_message_id = ?"
  )
    .bind(queueMsgId)
    .run();
}

// ─── Failure visibility ───────────────────────────────────────────────────────

async function recordPermanentFailure(
  env: Env,
  leadId: string,
  attempts: number,
  error: unknown,
  queueMsgId: string
): Promise<void> {
  try {
    await env.DB.prepare(
      "UPDATE leads SET assessment = ? WHERE id = ?"
    )
      .bind("⚠️ AI reply failed — needs manual response", leadId)
      .run();

    await insertDomainEvent(env.DB, env.ORGANIZATION_ID, {
      type: "lead.ai_failed",
      payload: {
        leadId,
        error: String(error),
        attempts,
        queueMessageId: queueMsgId,
      },
    });
  } catch (inner) {
    console.error(
      `[${env.ORGANIZATION_ID}] Could not record AI failure for lead ${leadId}:`,
      inner
    );
  }
}

// ─── AI processing ────────────────────────────────────────────────────────────

async function emitTyping(
  env: Env,
  leadId: string,
  type: "typing.started" | "typing.stopped"
) {
  await insertDomainEvent(env.DB, env.ORGANIZATION_ID, {
    type,
    payload: { leadId },
  });
}

async function resolveInboundForAi(
  env: Env,
  lead: Lead,
  messageId: string
): Promise<string> {
  if (messageId === "intake") {
    const dbSchedule = await loadScheduleForLead(env, lead);
    let scheduleLine: string | undefined;
    if (ragEnabled(env)) {
      const chunks = await retrieveKnowledge(
        env,
        env.ORGANIZATION_ID,
        lead.locationId,
        buildRagQuery(
          "class schedule times",
          lead.interest,
          lead.location,
          lead.locationId
        )
      );
      scheduleLine = pickScheduleLine(lead, chunks, dbSchedule);
    } else if (dbSchedule) {
      scheduleLine = pickScheduleLine(lead, [], dbSchedule);
    }
    return buildWebsiteIntakePrompt(lead, scheduleLine, dbSchedule);
  }
  const lastInbound = [...lead.messages]
    .reverse()
    .find((m) => m.kind === "chat" && m.from === "lead");
  return lastInbound?.kind === "chat" ? lastInbound.text : "";
}

async function processSimulateReply(
  env: Env,
  leadId: string,
  queueMsgId: string,
  inboundRef = ""
): Promise<void> {
  // Demo timing
  if (leadId === "olivia") {
    await new Promise((r) => setTimeout(r, 2300));
  }

  let lead = await getLead(env, leadId);
  if (!lead || lead.aiPaused) return;

  const inboundText = await resolveInboundForAi(env, lead, inboundRef);

  if (inboundRef && inboundRef !== "intake") {
    lead = (await getLead(env, leadId)) ?? lead;
  }

  await emitTyping(env, leadId, "typing.started");
  await new Promise((r) => setTimeout(r, 2200));
  await emitTyping(env, leadId, "typing.stopped");

  const reply = await generateAiReply(env, leadId, inboundText);
  const sortOrder = await nextMessageSortOrder(env.DB, leadId);

  const chatMsg: ChatMessage = {
    kind: "chat",
    from: "ai",
    text: reply.text,
    time: nowTimeLabel(),
    reasoning: reply.reasoning,
  };

  const messageId = await insertMessage(env.DB, leadId, sortOrder, chatMsg);

  if (
    reply.preview ||
    reply.assessment ||
    reply.status ||
    reply.trialSlotLabel
  ) {
    await updateLeadFields(env, leadId, {
      preview: reply.preview,
      assessment: reply.assessment,
      status: reply.status,
      statusLabel: reply.statusLabel,
      trialSlot: reply.trialSlot ?? undefined,
      trialSlotLabel: reply.trialSlotLabel ?? undefined,
      trialProposedJson: reply.trialProposed
        ? JSON.stringify(reply.trialProposed)
        : undefined,
      trialConfirmedAt:
        reply.status === "booked" ? new Date().toISOString() : undefined,
    });
  }

  const updated = await getLead(env, leadId);
  if (!updated) return;

  await insertDomainEvent(env.DB, env.ORGANIZATION_ID, {
    type: "message.created",
    payload: { leadId, message: { ...chatMsg, id: messageId } },
  });

  await insertDomainEvent(env.DB, env.ORGANIZATION_ID, {
    type: "lead.updated",
    payload: {
      leadId,
      patch: {
        preview: updated.preview,
        assessment: updated.assessment,
        status: updated.status,
      },
    },
  });

  if (!reply.skipSms && twilioConfigured(env) && updated.phone) {
    const smsBody = reply.smsText ?? reply.text;
    try {
      // Mark lock BEFORE sending — worst case a failed send means the lead
      // doesn't get this reply (recoverable), not that they get it twice (confusing).
      await markSmsSent(env, queueMsgId);
      await sendTwilioSms(env, updated.phone, smsBody);
    } catch (e) {
      console.error("Failed to send Twilio SMS", e);
    }
  }
}

async function processInbound(
  env: Env,
  leadId: string,
  messageId: string,
  queueMsgId: string
): Promise<void> {
  await processSimulateReply(env, leadId, queueMsgId, messageId);
}

// ─── Batch handler ────────────────────────────────────────────────────────────

export async function handleQueueBatch(
  batch: MessageBatch<QueueMessage>,
  env: Env
): Promise<void> {
  for (const msg of batch.messages) {
    const attempts = (msg as unknown as { attempts?: number }).attempts ?? 1;
    const body = msg.body;
    const leadId =
      body.type === "process_inbound" || body.type === "simulate_ai_reply"
        ? body.leadId
        : "";

    // ── Send-lock check: skip if SMS was already sent on a prior attempt ──────
    if (leadId) {
      const lock = await checkSendLock(env, msg.id);
      if (lock.smsSent) {
        console.warn(
          `[${env.ORGANIZATION_ID}] Queue message ${msg.id} already sent SMS. Skipping retry.`
        );
        msg.ack();
        continue;
      }
      if (!lock.exists) {
        await insertSendLock(env, msg.id, leadId);
      }
    }

    try {
      if (body.type === "process_inbound") {
        await processInbound(env, body.leadId, body.messageId, msg.id);
      } else if (body.type === "simulate_ai_reply") {
        await processSimulateReply(env, body.leadId, msg.id);
      }
      msg.ack();
    } catch (e) {
      if (attempts >= MAX_ATTEMPTS) {
        console.error(
          `[${env.ORGANIZATION_ID}] PERMANENT AI FAILURE — lead ${leadId}, ${attempts} attempts:`,
          e
        );

        if (leadId) {
          await recordPermanentFailure(env, leadId, attempts, e, msg.id);
        }

        msg.ack();
      } else {
        console.warn(
          `[${env.ORGANIZATION_ID}] Queue attempt ${attempts} failed for lead ${leadId}, retrying:`,
          e
        );
        msg.retry();
      }
    }
  }
}
