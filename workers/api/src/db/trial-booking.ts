import type { TrialProposal } from "@lead-intake/shared-types";
import { insertDomainEvent } from "./events";
import { getLead, updateLeadFields } from "./leads";
import type { Env } from "../env";

export async function proposeTrial(
  env: Env,
  leadId: string,
  proposal: TrialProposal
): Promise<void> {
  const assessment = `Trial proposed — ${proposal.label}`;
  const preview = `Trial · ${proposal.label} · awaiting yes`;

  await updateLeadFields(env, leadId, {
    assessment,
    preview,
    status: "qualified",
    statusLabel: "Qualified",
    trialProposedJson: JSON.stringify(proposal),
  });

  await insertDomainEvent(env.DB, env.ORGANIZATION_ID, {
    type: "lead.updated",
    payload: {
      leadId,
      patch: {
        assessment,
        preview,
        status: "qualified",
        statusLabel: "Qualified",
        trialProposed: proposal,
      },
    },
  });
}

export async function confirmTrial(
  env: Env,
  leadId: string,
  proposal: TrialProposal
): Promise<void> {
  const lead = await getLead(env, leadId);
  if (!lead) return;

  const assessment = `Trial booked — ${proposal.label}`;
  const preview = `Free trial · ${proposal.label} · ${lead.location}`;
  const now = new Date().toISOString();

  await updateLeadFields(env, leadId, {
    assessment,
    preview,
    status: "booked",
    statusLabel: "Booked",
    trialSlot: proposal.slotId,
    trialSlotLabel: proposal.label,
    trialProposedJson: JSON.stringify(proposal),
    trialConfirmedAt: now,
  });

  await env.DB.prepare(
    `INSERT INTO timeline_events (id, lead_id, sort_order, time_label, parts_json)
     VALUES (?, ?, (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM timeline_events WHERE lead_id = ?), 'now', ?)`
  )
    .bind(
      crypto.randomUUID(),
      leadId,
      leadId,
      JSON.stringify([
        {
          bold: "Trial booked",
          text: ` · ${proposal.label} · ${lead.interest}`,
        },
      ])
    )
    .run();

  await insertDomainEvent(env.DB, env.ORGANIZATION_ID, {
    type: "lead.updated",
    payload: {
      leadId,
      patch: {
        assessment,
        preview,
        status: "booked",
        statusLabel: "Booked",
        trialSlot: proposal.slotId,
        trialSlotLabel: proposal.label,
        trialProposed: proposal,
      },
    },
  });
}
