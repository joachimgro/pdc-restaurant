import type { Lead } from "@lead-intake/shared-types";
import {
  buildScheduleSummary,
  formatTimesPhrase,
  type ProgrammeSchedule,
  uniqueTimesFromSlots,
} from "../db/location-schedules";
import type { RetrievedChunk } from "./rag";

/** Inbox list preview before the AI has sent the first text. */
export function buildIntakePreview(
  interest: string,
  locationName: string
): string {
  const text = `${interest} · ${locationName}`;
  return text.length > 56 ? text.slice(0, 53) + "..." : text;
}

export function displayFirstName(name: string): string {
  const first = (name ?? "").trim().split(/\s+/)[0] ?? "";
  if (!first || first.length < 2) return "there";
  // Phone numbers used as placeholder names
  if (/^\+?\d[\d\s\-]{5,}$/.test(first)) return "there";
  // SMS slugs like "sms-07700123456"
  if (/^sms-/i.test(first)) return "there";
  // Generic fallbacks
  if (/^(new|unknown|lead|user|customer)$/i.test(first)) return "there";
  return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
}

function interestKeywords(interest: string): string[] {
  const i = interest.toLowerCase();
  const keys: string[] = [];
  if (i.includes("muay thai")) keys.push("muay thai");
  if (i.includes("bjj")) keys.push("bjj");
  if (i.includes("karate")) keys.push("karate");
  if (i.includes("mma")) keys.push("mma");
  if (i.includes("kickboxing")) keys.push("kickboxing");
  if (keys.length === 0) keys.push(interest.toLowerCase());
  return keys;
}

function chunkMentionsOtherBranch(
  chunkLocationId: string | null | undefined,
  leadLocationId: string
): boolean {
  return Boolean(
    chunkLocationId && leadLocationId && chunkLocationId !== leadLocationId
  );
}

function scoreScheduleChunk(chunk: RetrievedChunk, lead: Lead): number {
  let score = chunk.score ?? 0;
  const text = chunk.text.toLowerCase();
  const loc = lead.locationId ?? "";
  if (chunk.locationId === loc) score += 20;
  else if (chunk.locationId) score -= 30;
  if (chunkMentionsOtherBranch(chunk.locationId, loc)) score -= 50;
  for (const kw of interestKeywords(lead.interest)) {
    if (text.includes(kw)) score += 8;
  }
  return score;
}

function extractSchedulePhrase(chunkText: string): string {
  const colon = chunkText.indexOf(":");
  const body = colon >= 0 ? chunkText.slice(colon + 1).trim() : chunkText;
  const firstSentence = body.split(/[.!]\s/)[0]?.trim() ?? body;
  if (firstSentence.length > 90) return firstSentence.slice(0, 87) + "…";
  if (/^on /i.test(firstSentence)) return firstSentence;
  return `on ${firstSentence.charAt(0).toLowerCase()}${firstSentence.slice(1)}`;
}

export function pickScheduleLine(
  lead: Lead,
  chunks: RetrievedChunk[] = [],
  dbSchedule?: ProgrammeSchedule | null
): string {
  if (dbSchedule?.slots.length) {
    return buildScheduleSummary(dbSchedule);
  }

  const ranked = [...chunks]
    .filter((c) => !chunkMentionsOtherBranch(c.locationId, lead.locationId ?? ""))
    .sort((a, b) => scoreScheduleChunk(b, lead) - scoreScheduleChunk(a, lead));

  const best = ranked.find(
    (c) =>
      c.locationId === lead.locationId &&
      interestKeywords(lead.interest).some((kw) =>
        c.text.toLowerCase().includes(kw)
      )
  );
  if (best) return extractSchedulePhrase(best.text);

  return "through the week — we'll confirm exact times when you book your trial";
}

export function buildLeadIntakeContextBlock(
  lead: Lead,
  scheduleLine?: string,
  dbSchedule?: ProgrammeSchedule | null
): string {
  const firstName = displayFirstName(lead.name);
  const child = lead.child
    ? `Child on form: ${lead.child.name}, age ${lead.child.age}, experience: ${lead.child.experience}`
    : "Adult enquiry (no child on form)";
  const schedule =
    scheduleLine ?? pickScheduleLine(lead, [], dbSchedule);

  const timesOffer =
    dbSchedule?.slots.length
      ? formatTimesPhrase(uniqueTimesFromSlots(dbSchedule.slots))
      : "";

  let bookingRules = "";
  if (lead.trialSlotLabel) {
    bookingRules = `Booked trial: ${lead.trialSlotLabel} — do not re-offer unless they ask to change.`;
  } else if (lead.trialProposed) {
    bookingRules = `Proposed trial: ${lead.trialProposed.label} — waiting for lead to reply YES before marking booked.`;
  } else if (dbSchedule?.slots.length) {
    bookingRules = `Class times ${timesOffer} on scheduled days only (not every day). When they pick a day+time, PROPOSE the trial and ask them to reply yes — do NOT mark booked until they confirm.`;
  }

  return `=== LEAD CONTEXT (website form — ALWAYS true for this conversation) ===
First name: ${firstName}
Full name: ${lead.name}
Branch: ${lead.location} ONLY (location id: ${lead.locationId})
Programme: ${lead.interest}
${child}
Phone: ${lead.phone}
Schedule: ${schedule}
${bookingRules ? `${bookingRules}\n` : ""}
Hard rules:
- Use branch "${lead.location}" and programme "${lead.interest}" unless they ask to change.
- NEVER substitute a different class (e.g. do not say BJJ if the form says ${lead.interest}).
- Once a day and time are agreed, confirm warmly — do NOT ask them to pick again from 5pm / 7:30pm / 8:30pm.
- Read the thread; do not re-ask answered questions.
- Never output template tags like {firstName}.`;
}

export function buildWelcomeSms(
  lead: Lead,
  scheduleLine?: string,
  dbSchedule?: ProgrammeSchedule | null
): string {
  const firstName = displayFirstName(lead.name);
  const lessonType = lead.interest;
  const branch = lead.location;

  if (dbSchedule?.slots.length) {
    const summary = scheduleLine ?? buildScheduleSummary(dbSchedule);
    return `Hey ${firstName}! Thanks for getting in touch.

We run ${lessonType} at our ${branch} branch — ${summary}.

We'd love to offer you a free trial! Which day and time suit you best?`;
  }

  const time = scheduleLine ?? pickScheduleLine(lead, [], dbSchedule);
  const timePhrase =
    time.startsWith("on ") || time.startsWith("with ") || time.startsWith("through")
      ? time
      : `on ${time}`;

  return `Hey ${firstName}! Thanks for getting in touch.

We run ${lessonType} at our ${branch} branch ${timePhrase}.

We'd love to offer you a free trial to see if you'd enjoy it! Which day works best for you?`;
}

export function buildWebsiteIntakePrompt(
  lead: Lead,
  scheduleLine?: string,
  dbSchedule?: ProgrammeSchedule | null
): string {
  const schedule = scheduleLine ?? pickScheduleLine(lead, [], dbSchedule);
  const welcome = buildWelcomeSms(lead, schedule, dbSchedule);

  return `[WEBSITE FORM — lead has NOT texted yet]

Send EXACTLY this welcome SMS (you may fix minor punctuation only; keep branch, programme, and times):

"""
${welcome}
"""

${buildLeadIntakeContextBlock(lead, schedule, dbSchedule)}`;
}

export function isWebsiteIntakePrompt(text: string): boolean {
  return text.includes("[WEBSITE FORM");
}

export function isFirstWelcomeTurn(
  lead: Lead,
  inboundText: string,
  history: { role: string }[]
): boolean {
  if (!isWebsiteIntakePrompt(inboundText)) return false;
  const hasLeadChat = history.some((h) => h.role === "lead");
  const hasAiChat = history.some((h) => h.role === "ai");
  return !hasLeadChat && !hasAiChat;
}

export function welcomeReplyFromLead(
  lead: Lead,
  scheduleLine?: string,
  dbSchedule?: ProgrammeSchedule | null
): { text: string; schedule: string } {
  const schedule = scheduleLine ?? pickScheduleLine(lead, [], dbSchedule);
  return {
    text: buildWelcomeSms(lead, schedule, dbSchedule),
    schedule,
  };
}
