import { oliviaSimulateForProfile } from "@lead-intake/seed-data";
import type { Message } from "@lead-intake/shared-types";
import { jsonResponse } from "../cors";
import { logStaffActivity } from "../auth/activity";
import { insertDomainEvent } from "../db/events";
import { getStaffSession } from "../auth/session";
import {
  deleteLead,
  getLead,
  insertLeadNote,
  insertMessage,
  leadExists,
  listLeadsSummaries,
  markLeadRead,
  nextMessageSortOrder,
  nowTimeLabel,
  updateLeadFields,
} from "../db/leads";
import { sendTwilioSms, twilioConfigured } from "../twilio/send";
import type { Env } from "../env";

function simulateProfile(env: Env) {
  return env.ORGANIZATION_ID === "phiof" && env.ENABLE_DEMO_TOOLS === "true"
    ? "tuition"
    : "default";
}

export async function handleListLeads(
  request: Request,
  env: Env
): Promise<Response> {
  const data = await listLeadsSummaries(env);
  return jsonResponse(request, env, data);
}

export async function handleGetLead(
  request: Request,
  env: Env,
  id: string
): Promise<Response> {
  const lead = await getLead(env, id);
  if (!lead) return jsonResponse(request, env, { error: "Not found" }, 404);
  return jsonResponse(request, env, lead);
}

export async function handleDeleteLead(
  request: Request,
  env: Env,
  id: string
): Promise<Response> {
  const removed = await deleteLead(env, id);
  if (!removed) {
    return jsonResponse(request, env, { error: "Not found" }, 404);
  }
  return jsonResponse(request, env, {
    ok: true,
    leadId: id,
    message: "Contact and all conversation data deleted.",
  });
}

export async function handleSelectLead(
  request: Request,
  env: Env,
  id: string
): Promise<Response> {
  if (!(await leadExists(env.DB, id))) {
    return jsonResponse(request, env, { error: "Not found" }, 404);
  }
  await markLeadRead(env, id);
  const lead = await getLead(env, id);
  return jsonResponse(request, env, lead);
}

export async function handleTakeover(
  request: Request,
  env: Env,
  id: string
): Promise<Response> {
  const session = await getStaffSession(env, request);
  if (!session) {
    return jsonResponse(request, env, { error: "Unauthorized" }, 401);
  }

  if (!(await leadExists(env.DB, id))) {
    return jsonResponse(request, env, { error: "Not found" }, 404);
  }
  await updateLeadFields(env, id, { aiPaused: true });
  await logStaffActivity(
    env,
    session.row.id,
    session.displayLabel,
    "lead.takeover",
    { leadId: id }
  );
  await insertDomainEvent(env.DB, env.ORGANIZATION_ID, {
    type: "lead.updated",
    payload: { leadId: id, patch: { aiPaused: true } },
  });
  const lead = await getLead(env, id);
  return jsonResponse(request, env, lead);
}

export async function handleResumeAi(
  request: Request,
  env: Env,
  id: string
): Promise<Response> {
  const session = await getStaffSession(env, request);
  if (!session) {
    return jsonResponse(request, env, { error: "Unauthorized" }, 401);
  }

  if (!(await leadExists(env.DB, id))) {
    return jsonResponse(request, env, { error: "Not found" }, 404);
  }
  await updateLeadFields(env, id, { aiPaused: false });
  await logStaffActivity(
    env,
    session.row.id,
    session.displayLabel,
    "lead.resume_ai",
    { leadId: id }
  );
  await insertDomainEvent(env.DB, env.ORGANIZATION_ID, {
    type: "lead.updated",
    payload: { leadId: id, patch: { aiPaused: false } },
  });
  const lead = await getLead(env, id);
  return jsonResponse(request, env, lead);
}

export async function handleSimulateNewLead(
  request: Request,
  env: Env
): Promise<Response> {
  if (await leadExists(env.DB, "olivia")) {
    return jsonResponse(request, env, { error: "Already simulated" }, 409);
  }

  const id = "olivia";
  const fixture = oliviaSimulateForProfile(simulateProfile(env));
  await env.DB.prepare(
    `INSERT INTO leads (
      id, organization_id, location_id, name, phone, time_label,
      status, status_label, assessment, preview, unread, source, interest,
      child_json, list_group, sort_order, just_arrived
    ) VALUES (?, ?, ?, ?, ?, ?, 'new', 'New', ?, ?, 1, ?, ?, NULL, 'today', 0, 1)`
  )
    .bind(
      id,
      env.ORGANIZATION_ID,
      fixture.locationId,
      fixture.name,
      fixture.phone,
      nowTimeLabel(),
      "Identifying interest…",
      fixture.inboundText.slice(0, 48) + "...",
      fixture.source,
      fixture.interest
    )
    .run();

  const now = nowTimeLabel();
  await env.DB.prepare(
    `INSERT INTO timeline_events (id, lead_id, sort_order, time_label, parts_json)
     VALUES (?, ?, 0, ?, ?)`
  )
    .bind(
      crypto.randomUUID(),
      id,
      now,
      JSON.stringify([
        { bold: "New lead", text: " · Simulated lead" },
      ])
    )
    .run();

  await insertMessage(env.DB, id, 0, {
    kind: "day",
    day: "Today, just now",
  });

  await insertMessage(env.DB, id, 1, {
    kind: "chat",
    from: "lead",
    text: fixture.inboundText,
    time: now,
  });

  const lead = await getLead(env, id);
  if (!lead) return jsonResponse(request, env, { error: "Failed" }, 500);

  await insertDomainEvent(env.DB, env.ORGANIZATION_ID, {
    type: "lead.created",
    payload: { lead },
  });

  // Schedule AI reply via queue (async, non-blocking)
  await env.AI_QUEUE.send({ type: "simulate_ai_reply", leadId: id });

  return jsonResponse(request, env, { lead, queued: true });
}

export async function handleSendStaffMessage(
  request: Request,
  env: Env,
  id: string
): Promise<Response> {
  const session = await getStaffSession(env, request);
  if (!session) {
    return jsonResponse(request, env, { error: "Unauthorized" }, 401);
  }

  const lead = await getLead(env, id);
  if (!lead) return jsonResponse(request, env, { error: "Not found" }, 404);
  if (!lead.aiPaused) {
    return jsonResponse(
      request,
      env,
      { error: "AI is not paused — take over the conversation first" },
      409
    );
  }

  let body: { text?: unknown };
  try {
    body = (await request.json()) as { text?: unknown };
  } catch {
    return jsonResponse(request, env, { error: "Invalid JSON" }, 400);
  }

  const text =
    typeof body.text === "string" ? body.text.trim() : "";
  if (!text) {
    return jsonResponse(request, env, { error: "Message text is required" }, 400);
  }

  const msgTime = nowTimeLabel();
  const sortOrder = await nextMessageSortOrder(env.DB, id);
  const messageId = await insertMessage(env.DB, id, sortOrder, {
    kind: "chat",
    from: "staff",
    text,
    time: msgTime,
    staffUserId: session.row.id,
    staffAuthorName: session.displayLabel,
  });

  await logStaffActivity(
    env,
    session.row.id,
    session.displayLabel,
    "message.sent",
    { leadId: id, metadata: { messageId } }
  );

  await insertDomainEvent(env.DB, env.ORGANIZATION_ID, {
    type: "message.created",
    payload: {
      leadId: id,
      message: {
        kind: "chat",
        id: messageId,
        from: "staff",
        text,
        time: msgTime,
        staffAuthorName: session.displayLabel,
        staffUserId: session.row.id,
      },
    },
  });

  // Send SMS if Twilio is configured
  let smsSent = false;
  if (twilioConfigured(env) && lead.phone) {
    try {
      await sendTwilioSms(env, lead.phone, text);
      smsSent = true;
    } catch (e) {
      console.error("Staff SMS send failed", e);
      // We still save the message in DB; warn but don't fail the request
    }
  }

  const updated = await getLead(env, id);
  return jsonResponse(request, env, { lead: updated, smsSent });
}

export async function handleAddLeadNote(
  request: Request,
  env: Env,
  id: string
): Promise<Response> {
  const session = await getStaffSession(env, request);
  if (!session) {
    return jsonResponse(request, env, { error: "Unauthorized" }, 401);
  }

  if (!(await leadExists(env.DB, id))) {
    return jsonResponse(request, env, { error: "Not found" }, 404);
  }

  let body: { body?: unknown };
  try {
    body = (await request.json()) as { body?: unknown };
  } catch {
    return jsonResponse(request, env, { error: "Invalid JSON" }, 400);
  }

  const text = typeof body.body === "string" ? body.body.trim() : "";
  if (!text) {
    return jsonResponse(request, env, { error: "Note body is required" }, 400);
  }

  await insertLeadNote(
    env.DB,
    id,
    text,
    session.displayLabel,
    session.row.id
  );

  await logStaffActivity(
    env,
    session.row.id,
    session.displayLabel,
    "note.added",
    { leadId: id }
  );

  await insertDomainEvent(env.DB, env.ORGANIZATION_ID, {
    type: "lead.updated",
    payload: { leadId: id, patch: { notesUpdated: true } },
  });

  const lead = await getLead(env, id);
  return jsonResponse(request, env, lead);
}
