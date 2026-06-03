import { OLIVIA_SIMULATE } from "@lead-intake/seed-data";
import type { Message } from "@lead-intake/shared-types";
import { jsonResponse } from "../cors";
import { insertDomainEvent } from "../db/events";
import {
  deleteLead,
  getLead,
  insertMessage,
  leadExists,
  listLeadsSummaries,
  markLeadRead,
  nextMessageSortOrder,
  updateLeadFields,
} from "../db/leads";
import type { Env } from "../env";

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
  if (!(await leadExists(env.DB, id))) {
    return jsonResponse(request, env, { error: "Not found" }, 404);
  }
  await updateLeadFields(env, id, { aiPaused: true });
  await insertDomainEvent(env.DB, env.ORGANIZATION_ID, {
    type: "lead.updated",
    payload: { leadId: id, patch: { aiPaused: true } },
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
  await env.DB.prepare(
    `INSERT INTO leads (
      id, organization_id, location_id, name, phone, time_label,
      status, status_label, assessment, preview, unread, source, interest,
      child_json, list_group, sort_order, just_arrived
    ) VALUES (?, ?, ?, ?, ?, 'now', 'new', 'New', ?, ?, 1, ?, ?, NULL, 'today', 0, 1)`
  )
    .bind(
      id,
      env.ORGANIZATION_ID,
      OLIVIA_SIMULATE.locationId,
      OLIVIA_SIMULATE.name,
      OLIVIA_SIMULATE.phone,
      "Identifying interest…",
      OLIVIA_SIMULATE.inboundText.slice(0, 48) + "...",
      OLIVIA_SIMULATE.source,
      OLIVIA_SIMULATE.interest
    )
    .run();

  await env.DB.prepare(
    `INSERT INTO timeline_events (id, lead_id, sort_order, time_label, parts_json)
     VALUES (?, ?, 0, 'now', ?)`
  )
    .bind(
      crypto.randomUUID(),
      id,
      JSON.stringify([
        { bold: "New lead", text: " · Referral SMS" },
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
    text: OLIVIA_SIMULATE.inboundText,
    time: "now",
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
