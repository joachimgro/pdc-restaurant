import type { TrialProposal } from "@lead-intake/shared-types";
import { resolveProgrammeLabel } from "../ai/programme-resolve";
import { ensureLeadProgramme } from "../ai/qualification";
import type { ProgrammeSchedule } from "./location-schedules";
import { insertDomainEvent } from "./events";
import { getLead, nowTimeLabel, updateLeadFields } from "./leads";
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

type ConfirmTrialOpts = {
  schedule?: ProgrammeSchedule | null;
  history?: { role: string; text: string }[];
};

export async function confirmTrial(
  env: Env,
  leadId: string,
  proposal: TrialProposal,
  opts?: ConfirmTrialOpts
): Promise<void> {
  let lead = await getLead(env, leadId);
  if (!lead) return;

  await ensureLeadProgramme(env, leadId, lead, opts);
  lead = (await getLead(env, leadId)) ?? lead;

  const programme = resolveProgrammeLabel(lead, opts);
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
     VALUES (?, ?, (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM timeline_events WHERE lead_id = ?), ?, ?)`
  )
    .bind(
      crypto.randomUUID(),
      leadId,
      leadId,
      nowTimeLabel(),
      JSON.stringify([
        {
          bold: "Trial booked",
          text: programme
            ? ` · ${proposal.label} · ${programme}`
            : ` · ${proposal.label}`,
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
