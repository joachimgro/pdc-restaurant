import type { Message as ChatMessage } from "@lead-intake/shared-types";
import { insertDomainEvent } from "../db/events";
import {
  getLead,
  insertMessage,
  nextMessageSortOrder,
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
  inboundRef = ""
): Promise<void> {
  // Match demo timing: 1.5s until select + 800ms before typing
  if (leadId === "olivia") {
    await new Promise((r) => setTimeout(r, 2300));
  }

  let lead = await getLead(env, leadId);
  if (!lead || lead.aiPaused) return;

  const inboundText = await resolveInboundForAi(env, lead, inboundRef);

  // Re-load after resolve so inbound SMS is definitely in the thread
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
    time: "now",
    reasoning: reply.reasoning,
  };

  const messageId = await insertMessage(
    env.DB,
    leadId,
    sortOrder,
    chatMsg
  );

  if (reply.preview || reply.assessment || reply.status) {
    await updateLeadFields(env, leadId, {
      preview: reply.preview,
      assessment: reply.assessment,
      status: reply.status,
      statusLabel: reply.statusLabel,
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

  if (
    !reply.skipSms &&
    twilioConfigured(env) &&
    updated.phone
  ) {
    const smsBody = reply.smsText ?? reply.text;
    try {
      await sendTwilioSms(env, updated.phone, smsBody);
    } catch (e) {
      console.error("Failed to send Twilio SMS", e);
    }
  }
}

async function processInbound(
  env: Env,
  leadId: string,
  messageId: string
): Promise<void> {
  await processSimulateReply(env, leadId, messageId);
}

export async function handleQueueBatch(
  batch: MessageBatch<QueueMessage>,
  env: Env
): Promise<void> {
  for (const msg of batch.messages) {
    try {
      const body = msg.body;
      if (body.type === "process_inbound") {
        await processInbound(env, body.leadId, body.messageId);
      } else if (body.type === "simulate_ai_reply") {
        await processSimulateReply(env, body.leadId);
      }
      msg.ack();
    } catch (e) {
      console.error("Queue consumer error", e);
      msg.retry();
    }
  }
}
