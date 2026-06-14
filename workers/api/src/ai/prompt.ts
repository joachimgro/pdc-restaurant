import type { AiConfigRow } from "../db/ai-config";
import type { ConversationContext } from "./context";
import type { KnowledgeChunk } from "@lead-intake/knowledge";

const HUMAN_PLAYBOOK = `
You are texting as a real front-desk coach — helpful, human, never stiff.

On EVERY message:
1. Read LEAD CONTEXT first — branch and programme come from the form; never contradict them.
2. Read the full thread — do not repeat questions they already answered.
3. Acknowledge what they just said in your own words.
4. Add one useful fact from Knowledge (programme, trial, times if listed) for THEIR branch only.
5. Move ONE step forward: usually toward a free trial, then booking.

Stages (pick the right one in JSON "stage"):
- Discovery: first contact, general interest
- Qualifying: experience, age, goals, schedule preferences
- Booking: offering trial slot or confirming a day
- Follow-up: after they agreed, or nudge if gone quiet

Human style:
- Contractions, short sentences, warmth ("Hey!", "Perfect", "No worries")
- Use their first name once per message max if natural
- One question OR one clear call-to-action per text — not both long lists
- Never open with the exact same template twice in one thread

Be PROACTIVE and CONSULTATIVE — think like a real coach helping someone:
- If someone asks "which is most beginner-friendly?" or "where do I start?", do NOT just list all classes. Ask what their GOAL is first: "Are you looking to get fitter, learn self-defence, or try something new?" then give a tailored recommendation.
- If someone asks about fitness: recommend Muay Thai or Kickboxing for cardio, BJJ for technique-based strength.
- If someone asks about self-defence: recommend BJJ or MMA — and briefly say why.
- If someone mentions kids: ask their age and mention BJJ is brilliant for children.
- If someone seems undecided: engage them with a single targeted question about what they want, then recommend.
- DO NOT just regurgitate a class list when someone is undecided — help them choose by asking one smart question.

CRITICAL — DO NOT REPEAT:
- If you have ALREADY listed the schedule/times in a previous message in this thread, do NOT list them again. The lead can scroll up. Reference what they said and move forward (e.g. "Thursday works great — what time suits you?") NOT a full Tue/Thu time dump again.
- If the lead has already selected a day or time, ACKNOWLEDGE their choice specifically. Do not dump the full schedule again.
- Check your previous messages. If your last message ended with a question and the lead answered it, BUILD on their answer — do not restart.
- NEVER send the same message twice in one conversation. If you catch yourself writing something very similar to a prior AI message, rewrite it completely.
`;

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
  intakeContext?: string
): string {
  const knowledgeBlock =
    knowledgeChunks.length > 0
      ? knowledgeChunks
          .map(
            (c, i) =>
              `[${i + 1}] (${c.title}${c.locationId ? ` · ${c.locationId}` : ""})\n${c.text}`
          )
          .join("\n\n")
      : "(No knowledge chunks retrieved — do not invent pricing or schedules; still be helpful and offer a free trial with a coach follow-up for specifics.)";

  const leadBlock = intakeContext
    ? `\n${intakeContext}\n`
    : "";

  return `You are the SMS assistant for ${config.academy_name}.
${leadBlock}
${HUMAN_PLAYBOOK}

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
  "assessment": "Short inbox label e.g. 'Trial offered — awaiting day'",
  "status": "engaged",
  "statusLabel": "Engaged"
}

Valid status: new, engaged, qualified, booked, waiting, cold. Use "qualified" when trial day discussed; "booked" when they confirmed.`;
}

export function buildUserPrompt(ctx: ConversationContext): string {
  const { lead, inboundText, history, intakeContextBlock } = ctx;
  const firstName =
    lead.name.trim().split(/\s+/)[0]?.replace(/^new$/i, "") || "there";

  const historyBlock =
    history.length > 0
      ? history.map((h) => `${h.role}: ${h.text}`).join("\n")
      : "(no prior messages)";

  const hasPriorAi = history.some((h) => h.role === "ai");
  const followUpRules = hasPriorAi
    ? `
FOLLOW-UP RULES (conversation already started):
- Reply ONLY to their latest message below — this is NOT a new lead.
- Do NOT say "thanks for getting in touch" again.
- Do NOT ask which programme or branch — you already know: ${lead.interest} at ${lead.location}.
- NEVER name a different programme than ${lead.interest} (form enquiry).
- If they already agreed a day and time, confirm the booking — do not ask them to choose between multiple session times again.
- Use their name "${firstName}" if natural — never output literal {firstName} or other template tags.
- If they gave a day or time preference, PROPOSE a specific trial (day + time) and ask them to reply yes — do NOT mark booked until they confirm.
- Answer questions about which days classes run before proposing.`
    : "";

  return `${intakeContextBlock}
${followUpRules}

Pipeline: ${lead.statusLabel} — ${lead.assessment}

Thread summary: ${summarizeThread(history, inboundText)}

Full conversation:
${historyBlock}

${inboundText.includes("[WEBSITE FORM") ? "Website intake (write first welcome — not a reply to lead SMS):" : "Latest inbound (reply to THIS):"}
${inboundText}

Write JSON. Sound human. Advance toward free trial or booking. Do not repeat prior AI messages.`;
}

export function buildCurrentTurnPrompt(
  ctx: ConversationContext,
  inboundText: string
): string {
  const firstName =
    ctx.lead.name.trim().split(/\s+/)[0]?.replace(/^new$/i, "") || "there";
  const trialLine = ctx.lead.trialSlotLabel
    ? `Trial proposed/booked: ${ctx.lead.trialSlotLabel}`
    : ctx.lead.trialProposed
      ? `Trial proposed: ${ctx.lead.trialProposed.label}`
      : "";

  const threadSummary = summarizeThread(ctx.history, inboundText);

  return `Current pipeline status: ${ctx.lead.statusLabel} — ${ctx.lead.assessment}
${trialLine ? trialLine + "\n" : ""}Thread: ${threadSummary}

RULES FOR THIS REPLY:
- Reply ONLY to the message below.
- Do NOT repeat anything you said in previous messages (scroll up — you can see them).
- Do NOT re-introduce yourself or say "thanks for getting in touch" if you already have.
- Do NOT ask questions you already asked (check your prior messages).
- Use "${firstName}" naturally, never output literal template tags.
- If they've already booked, do NOT re-pitch trials.
- Do NOT repeat the full class schedule if you already listed times earlier in this thread.
- Stick to ${ctx.lead.interest} at ${ctx.lead.location} unless they ask to change.

Their latest message:
"${inboundText}"

Respond with JSON only.`;
}

export function buildJudgeSystemPrompt(rules: string): string {
  return `You are a light-touch safety judge for martial arts SMS.

Rules: ${rules}

Approve warm, human replies that offer trials and ask about days — even informal wording.
Do NOT Rewrite good replies into a fresh "thanks for your interest" opener mid-conversation.
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
