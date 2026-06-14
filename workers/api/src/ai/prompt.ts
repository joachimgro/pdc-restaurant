import type { AiConfigRow } from "../db/ai-config";
import type { ConversationContext } from "./context";
import type { KnowledgeChunk } from "@lead-intake/knowledge";
import {
  getPlatformPlaybook,
  getVerticalPlaybook,
  resolvePresetId,
} from "./playbooks";

function summarizeThread(
  history: ConversationContext["history"],
  inboundText: string
): string {
  if (history.length === 0) {
    if (inboundText.includes("[WEBSITE FORM")) {
      return "New thread — website form submitted; send first welcome SMS (lead has not texted).";
    }
    return "New thread — first AI reply.";
  }
  const leadCount = history.filter((h) => h.role === "lead").length;
  const aiCount = history.filter((h) => h.role === "ai").length;
  const lastLead = [...history].reverse().find((h) => h.role === "lead");
  return `${leadCount} lead message(s), ${aiCount} AI reply(ies). Last lead said: "${lastLead?.text.slice(0, 100) ?? ""}"`;
}

export function buildSystemPrompt(
  config: AiConfigRow,
  locationOverride: string | null,
  knowledgeChunks: KnowledgeChunk[],
  intakeContext?: string,
  opts?: { schedulingEnabled?: boolean; presetId?: string | null }
): string {
  const schedulingEnabled = opts?.schedulingEnabled !== false;
  const presetId = resolvePresetId(opts?.presetId ?? config.preset_id);
  const platformPlaybook = getPlatformPlaybook();
  const verticalPlaybook = getVerticalPlaybook(presetId, { schedulingEnabled });

  const knowledgeBlock =
    knowledgeChunks.length > 0
      ? knowledgeChunks
          .map(
            (c, i) =>
              `[${i + 1}] (${c.title}${c.locationId ? ` · ${c.locationId}` : ""})\n${c.text}`
          )
          .join("\n\n")
      : schedulingEnabled
        ? "(No knowledge chunks retrieved — do not invent pricing or schedules; still be helpful and offer a free trial with staff follow-up for specifics.)"
        : "(No knowledge chunks retrieved — do not invent pricing or schedules; capture their interest and say the team will follow up.)";

  const handoffRules = schedulingEnabled
    ? ""
    : `

HANDOFF MODE (scheduling disabled):
- NEVER confirm a booking, trial slot, or appointment in SMS.
- Capture preferred days/times if they mention them; say a team member will call to confirm.
- Do not set status to "booked" — use "engaged" or "qualified" only.
- Offer their next step (e.g. free assessment) but staff confirms timing.`;

  const leadBlock = intakeContext ? `\n${intakeContext}\n` : "";

  return `You are the SMS assistant for ${config.academy_name}.
${leadBlock}
${platformPlaybook}

${verticalPlaybook}
${handoffRules}

Tone: ${config.tone}

Goals: ${config.goals}

Rules: ${config.rules}
${locationOverride ? `\nLocation notes: ${locationOverride}` : ""}

Knowledge (ONLY use facts from this section for prices, times, policies):
${knowledgeBlock}

Respond with a single JSON object only, no markdown:
{
  "reply": "SMS under 300 chars — human, helpful, advances the conversation",
  "stage": "Discovery|Qualifying|Booking|Follow-up",
  "note": "What you understood + what step you moved them toward (for staff)",
  "assessment": "Short inbox label e.g. 'Handoff — awaiting staff'",
  "status": "engaged",
  "statusLabel": "Engaged"
}

Valid status: new, engaged, qualified, booked, waiting, cold.${schedulingEnabled ? ' Use "qualified" when trial day discussed; "booked" when they confirmed.' : ' Do NOT use "booked" — staff confirm offline.'}`;
}

export function buildUserPrompt(
  ctx: ConversationContext,
  opts?: { schedulingEnabled?: boolean }
): string {
  const schedulingEnabled = opts?.schedulingEnabled !== false;
  const { lead, inboundText, history, intakeContextBlock } = ctx;
  const firstName =
    lead.name.trim().split(/\s+/)[0]?.replace(/^new$/i, "") || "there";

  const historyBlock =
    history.length > 0
      ? history.map((h) => `${h.role}: ${h.text}`).join("\n")
      : "(no prior messages)";

  const hasPriorAi = history.some((h) => h.role === "ai");
  const schedulingFollowUp = schedulingEnabled
    ? `- If they gave a day or time preference, PROPOSE a specific trial (day + time) and ask them to reply yes — do NOT mark booked until they confirm.
- If they already agreed a day and time, confirm the booking — do not ask them to choose between multiple session times again.`
    : `- If they gave a day or time preference, note it and say the team will call to confirm — do NOT mark booked.`;

  const followUpRules = hasPriorAi
    ? `
FOLLOW-UP RULES (conversation already started):
- Reply ONLY to their latest message below — this is NOT a new lead.
- Do NOT say "thanks for getting in touch" again.
- Do NOT ask which programme or branch — you already know: ${lead.interest} at ${lead.location}.
- NEVER name a different programme than ${lead.interest} (form enquiry).
${schedulingFollowUp}
- Use their name "${firstName}" if natural — never output literal {firstName} or other template tags.
- Answer questions about which days sessions run before proposing (when scheduling enabled).`
    : "";

  const advanceCta = schedulingEnabled
    ? "Advance toward free trial or booking."
    : "Advance toward qualification and staff handoff (free assessment / callback).";

  return `${intakeContextBlock}
${followUpRules}

Pipeline: ${lead.statusLabel} — ${lead.assessment}

Thread summary: ${summarizeThread(history, inboundText)}

Full conversation:
${historyBlock}

${inboundText.includes("[WEBSITE FORM") ? "Website intake (write first welcome — not a reply to lead SMS):" : "Latest inbound (reply to THIS):"}
${inboundText}

Write JSON. Sound human. ${advanceCta} Do not repeat prior AI messages.`;
}

export function buildCurrentTurnPrompt(
  ctx: ConversationContext,
  inboundText: string,
  opts?: { schedulingEnabled?: boolean }
): string {
  const schedulingEnabled = opts?.schedulingEnabled !== false;
  const firstName =
    ctx.lead.name.trim().split(/\s+/)[0]?.replace(/^new$/i, "") || "there";
  const trialLine = ctx.lead.trialSlotLabel
    ? `Trial proposed/booked: ${ctx.lead.trialSlotLabel}`
    : ctx.lead.trialProposed
      ? `Trial proposed: ${ctx.lead.trialProposed.label}`
      : "";

  const threadSummary = summarizeThread(ctx.history, inboundText);
  const noRepitch = schedulingEnabled
    ? "- If they've already booked, do NOT re-pitch trials."
    : "- Do NOT confirm bookings in SMS — staff hand off offline.";

  return `Current pipeline status: ${ctx.lead.statusLabel} — ${ctx.lead.assessment}
${trialLine ? trialLine + "\n" : ""}Thread: ${threadSummary}

RULES FOR THIS REPLY:
- Reply ONLY to the message below.
- Do NOT repeat anything you said in previous messages (scroll up — you can see them).
- Do NOT re-introduce yourself or say "thanks for getting in touch" if you already have.
- Do NOT ask questions you already asked (check your prior messages).
- Use "${firstName}" naturally at most once if it fits — never output literal template tags.
${noRepitch}
- Do NOT repeat the full schedule if you already listed times earlier in this thread.
- Stick to ${ctx.lead.interest} at ${ctx.lead.location} unless they ask to change.

Their latest message:
"${inboundText}"

Respond with JSON only.`;
}

export function buildJudgeSystemPrompt(rules: string): string {
  return `You are a light-touch safety judge for business SMS.

Rules: ${rules}

Approve warm, human replies that advance the conversation — even informal wording.
Do NOT rewrite good replies into a fresh "thanks for your interest" opener mid-conversation.
Return JSON only:
{
  "verdict": "Approved" | "Rewrite" | "Hold",
  "stage": "Discovery|Qualifying|Booking|Follow-up",
  "note": "Brief reason",
  "finalReply": "only if Rewrite — fix a specific safety issue; never restart the thread"
}

Hold ONLY for invented prices/times, medical advice, or abuse.
Prefer Approved. Use Rewrite rarely — only to fix a factual/safety problem, not to rephrase.`;
}

export function buildJudgeUserPrompt(
  proposedReply: string,
  knowledgeChunks: KnowledgeChunk[]
): string {
  const knowledgeBlock =
    knowledgeChunks.length > 0
      ? knowledgeChunks.map((c) => `- ${c.text}`).join("\n")
      : "(no knowledge retrieved)";

  return `Knowledge:
${knowledgeBlock}

Proposed SMS:
${proposedReply}

Judge this message.`;
}
