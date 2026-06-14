import type { Message as ChatMessage } from "@lead-intake/shared-types";
import { domainEventStatement, insertDomainEvent } from "../db/events";
import {
  buildLeadUpdateStatement,
  buildMessageStatements,
  getLead,
  nextMessageSortOrder,
  nowTimeLabel,
} from "../db/leads";
import {
  buildWebsiteIntakePrompt,
  pickScheduleLine,
} from "../ai/intake-context";
import { ragEnabled, retrieveKnowledge, buildRagQuery } from "../ai/rag";
import { loadScheduleForLead } from "../schedule-runtime";
import { generateAiReply } from "../ai/pipeline";
import { checkAiRateLimit, recordAiCall } from "../ai/rate-limit";
import type { Lead } from "@lead-intake/shared-types";
import { sendTwilioSms, twilioConfigured } from "../twilio/send";
import { logger } from "../log";
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

// ─── Per-lead processing lock (Phase 3 Fix 1) ──────────────────────────────────
// Serialises AI processing per lead so two queue messages for the SAME lead
// (two quick texts, or SMS + Instagram once multi-channel lands) cannot both run
// the pipeline and send two replies. Channel-agnostic — keyed on lead_id.

const LEAD_LOCK_TTL_MS = 2 * 60 * 1000; // 2 minutes — longer than any LLM call.

/**
 * Try to acquire the lead lock. Returns true only if THIS queue message holds
 * it. The `ON CONFLICT ... WHERE expires_at < datetime('now')` clause overwrites
 * only an already-expired lock, so an active holder is never displaced; we then
 * confirm ownership with a follow-up read.
 */
async function acquireLeadLock(
  env: Env,
  leadId: string,
  queueMsgId: string
): Promise<boolean> {
  const expiresAt = new Date(Date.now() + LEAD_LOCK_TTL_MS).toISOString();

  await env.DB.prepare(
    `INSERT INTO lead_processing_locks (lead_id, locked_at, locked_by_queue_message_id, expires_at)
     VALUES (?, datetime('now'), ?, ?)
     ON CONFLICT(lead_id) DO UPDATE SET
       locked_at = excluded.locked_at,
       locked_by_queue_message_id = excluded.locked_by_queue_message_id,
       expires_at = excluded.expires_at
     WHERE lead_processing_locks.expires_at < datetime('now')`
  )
    .bind(leadId, queueMsgId, expiresAt)
    .run();

  const current = await env.DB.prepare(
    "SELECT locked_by_queue_message_id FROM lead_processing_locks WHERE lead_id = ?"
  )
    .bind(leadId)
    .first<{ locked_by_queue_message_id: string }>();

  return current?.locked_by_queue_message_id === queueMsgId;
}

/**
 * Release the lead lock, but only if we still own it (guards against releasing a
 * lock another consumer took over after ours expired mid-processing).
 */
async function releaseLeadLock(
  env: Env,
  leadId: string,
  queueMsgId: string
): Promise<void> {
  await env.DB.prepare(
    "DELETE FROM lead_processing_locks WHERE lead_id = ? AND locked_by_queue_message_id = ?"
  )
    .bind(leadId, queueMsgId)
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
    logger.error(env, "Could not record AI failure for lead", {
      error: String(inner),
      leadId,
      queueMessageId: queueMsgId,
    });
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

  const updated = await getLead(env, leadId);
  if (!updated) return;

  const willSend = !reply.skipSms && twilioConfigured(env) && !!updated.phone;

  // ── Group B (Phase 3 Fix 4): message + lead update + events, written
  //    atomically. Built here, executed AFTER the send on the send path. ──────
  const msg = buildMessageStatements(env.DB, leadId, sortOrder, chatMsg);
  const messageId = msg.id;
  const groupB: D1PreparedStatement[] = [...msg.statements];

  if (
    reply.preview ||
    reply.assessment ||
    reply.status ||
    reply.trialSlotLabel
  ) {
    groupB.push(
      buildLeadUpdateStatement(env.DB, leadId, {
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
      })
    );
  }

  groupB.push(
    domainEventStatement(env.DB, env.ORGANIZATION_ID, {
      type: "message.created",
      payload: { leadId, message: { ...chatMsg, id: messageId } },
    }).statement
  );
  groupB.push(
    domainEventStatement(env.DB, env.ORGANIZATION_ID, {
      type: "lead.updated",
      payload: {
        leadId,
        patch: {
          preview: reply.preview ?? updated.preview,
          assessment: reply.assessment ?? updated.assessment,
          status: reply.status ?? updated.status,
        },
      },
    }).statement
  );

  if (willSend) {
    const smsBody = reply.smsText ?? reply.text;
    try {
      // Fix 2: re-check ai_paused at the latest possible moment — immediately
      // before the irreversible send. Staff may have clicked "Take over" while
      // we were mid-pipeline. Abort WITHOUT writing the AI message.
      const fresh = await env.DB.prepare(
        "SELECT ai_paused FROM leads WHERE id = ? AND organization_id = ?"
      )
        .bind(leadId, env.ORGANIZATION_ID)
        .first<{ ai_paused: number }>();

      if (fresh?.ai_paused) {
        console.warn(
          `[${env.ORGANIZATION_ID}] Lead ${leadId} was taken over by staff mid-processing. Aborting AI send.`
        );
        await insertDomainEvent(env.DB, env.ORGANIZATION_ID, {
          type: "lead.ai_aborted",
          payload: { leadId, reason: "staff_takeover_mid_pipeline" },
        });
        return;
      }

      // Mark lock BEFORE sending — worst case a failed send means the lead
      // doesn't get this reply (recoverable), not that they get it twice (confusing).
      await markSmsSent(env, queueMsgId);
      await sendTwilioSms(env, updated.phone!, smsBody);
    } catch (e) {
      // Send failed: do NOT persist an undelivered AI message. Recoverable.
      logger.error(env, "Failed to send Twilio SMS", {
        error: String(e),
        leadId,
        queueMessageId: queueMsgId,
      });
      return;
    }
  }

  // Persist domain state. On the send path the SMS has already gone out, so a
  // write failure here means the lead has the reply but D1 doesn't — log loudly
  // and surface a visible event. On the no-send path, rethrow so the queue
  // retries cleanly (nothing irreversible happened).
  try {
    await env.DB.batch(groupB);
  } catch (e) {
    if (willSend) {
      logger.error(env, "CRITICAL: AI reply SENT but D1 write failed", {
        error: String(e),
        leadId,
        queueMessageId: queueMsgId,
        phase: "post_send_write",
      });
      await insertDomainEvent(env.DB, env.ORGANIZATION_ID, {
        type: "lead.sync_failure",
        payload: { leadId, error: String(e), phase: "post_send_write" },
      }).catch(() => {});
    } else {
      throw e;
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

      // ── Fix 1: acquire the per-lead lock. If another consumer holds it,
      //    back off and retry shortly so the two messages are serialised. ─────
      const acquired = await acquireLeadLock(env, leadId, msg.id);
      if (!acquired) {
        console.warn(
          `[${env.ORGANIZATION_ID}] Lead ${leadId} is locked by another consumer. Retrying in 5s.`
        );
        msg.retry({ delaySeconds: 5 });
        continue;
      }
    }

    try {
      if (leadId) {
        const rateCheck = await checkAiRateLimit(env);
        if (!rateCheck.allowed) {
          logger.error(env, "AI rate limit exceeded", {
            leadId,
            count: rateCheck.count,
            reason: rateCheck.reason,
            queueMessageId: msg.id,
          });

          await env.DB.prepare(
            "UPDATE leads SET assessment = ? WHERE id = ? AND organization_id = ?"
          )
            .bind(
              "⚠️ AI rate limit reached — needs manual response",
              leadId,
              env.ORGANIZATION_ID
            )
            .run();

          await insertDomainEvent(env.DB, env.ORGANIZATION_ID, {
            type: "lead.ai_rate_limited",
            payload: {
              leadId,
              count: rateCheck.count,
              reason: rateCheck.reason,
            },
          });

          msg.ack();
          continue;
        }

        await recordAiCall(env);
      }

      if (body.type === "process_inbound") {
        await processInbound(env, body.leadId, body.messageId, msg.id);
      } else if (body.type === "simulate_ai_reply") {
        await processSimulateReply(env, body.leadId, msg.id);
      }
      msg.ack();
    } catch (e) {
      if (attempts >= MAX_ATTEMPTS) {
        logger.error(env, "PERMANENT AI FAILURE", {
          error: String(e),
          leadId,
          attempts,
          queueMessageId: msg.id,
        });

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
    } finally {
      // Release the lead lock on every terminal path (success or final failure).
      // Guarded by queue_message_id so we never release another consumer's lock.
      if (leadId) {
        await releaseLeadLock(env, leadId, msg.id);
      }
    }
  }
}
