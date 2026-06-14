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

export interface ConfirmTrialResult {
  confirmed: boolean;
  /** True when the lead already had a confirmed trial — caller must not send a duplicate "you're booked" SMS. */
  alreadyConfirmed: boolean;
  existingSlotLabel?: string;
}

export async function confirmTrial(
  env: Env,
  leadId: string,
  proposal: TrialProposal,
  opts?: ConfirmTrialOpts
): Promise<ConfirmTrialResult> {
  let lead = await getLead(env, leadId);
  if (!lead) return { confirmed: false, alreadyConfirmed: false };

  await ensureLeadProgramme(env, leadId, lead, opts);
  lead = (await getLead(env, leadId)) ?? lead;

  const programme = resolveProgrammeLabel(lead, opts);
  const assessment = `Trial booked — ${proposal.label}`;
  const preview = `Free trial · ${proposal.label} · ${lead.location}`;
  const now = new Date().toISOString();

  // Guarded UPDATE: only confirms when no trial is already confirmed.
  // Two concurrent affirmatives can't both win — the second sees changes === 0.
  const result = await env.DB.prepare(
    `UPDATE leads
     SET assessment = ?, preview = ?, status = 'booked', status_label = 'Booked',
         trial_slot = ?, trial_slot_label = ?, trial_proposed_json = ?,
         trial_confirmed_at = ?, updated_at = datetime('now')
     WHERE id = ? AND organization_id = ? AND trial_confirmed_at IS NULL`
  )
    .bind(
      assessment,
      preview,
      proposal.slotId,
      proposal.label,
      JSON.stringify(proposal),
      now,
      leadId,
      env.ORGANIZATION_ID
    )
    .run();

  if ((result.meta.changes ?? 0) === 0) {
    console.warn(
      `[${env.ORGANIZATION_ID}] Trial confirm attempted on already-confirmed lead ${leadId}. Using existing slot.`
    );
    return {
      confirmed: false,
      alreadyConfirmed: true,
      existingSlotLabel: lead.trialSlotLabel,
    };
  }

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

  return { confirmed: true, alreadyConfirmed: false };
}
