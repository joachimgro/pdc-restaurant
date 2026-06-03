import type { Lead } from "@lead-intake/shared-types";
import { displayFirstName, pickScheduleLine } from "./intake-context";

type HistoryLine = { role: "lead" | "ai" | "staff"; text: string };

const MAX_SMS_FOLLOWUP = 320;

/** Replace literal template tags if the model copied them from knowledge. */
export function applyTemplateTokens(
  text: string,
  lead: Lead,
  scheduleLine?: string
): string {
  const firstName = displayFirstName(lead.name);
  const schedule = scheduleLine ?? pickScheduleLine(lead);
  const timePhrase =
    schedule.startsWith("on ") || schedule.startsWith("through")
      ? schedule
      : `on ${schedule}`;

  return text
    .replace(/\{firstName\}/gi, firstName)
    .replace(/\{programme\}/gi, lead.interest)
    .replace(/\{lessonType\}/gi, lead.interest)
    .replace(/\{branch\}/gi, lead.location)
    .replace(/\{location\}/gi, lead.location)
    .replace(/\{times?\}/gi, timePhrase)
    .replace(/\[lead first name\]/gi, firstName)
    .replace(/\[programme from form\]/gi, lead.interest);
}

/** Model echoed a first-contact script mid-conversation. */
export function looksLikeBrokenFollowUp(
  text: string,
  history: HistoryLine[]
): boolean {
  const priorAi = history.filter((h) => h.role === "ai").length;
  const priorLead = history.filter((h) => h.role === "lead").length;
  if (priorAi === 0) return false;

  const lower = text.toLowerCase();
  if (/\{[a-z]+\}/i.test(text)) return true;

  const soundsLikeFreshIntake =
    lower.includes("thanks for getting in touch") &&
    (lower.includes("which programme") ||
      lower.includes("reply with your choice") ||
      lower.includes("let you know our branch"));

  if (soundsLikeFreshIntake && priorLead > 0) return true;

  const soundsLikeResetScript =
    priorLead > 0 &&
    priorAi > 0 &&
    (lower.includes("i noticed you're interested") ||
      lower.includes("noticed you're interested in our classes") ||
      lower.includes("thanks for your interest in our") ||
      (lower.includes("which time suits you") &&
        (lower.includes("free trial") || lower.includes("muay thai"))));

  if (soundsLikeResetScript) return true;

  // Contradicts a prior Tue/Thu-only welcome with "daily"
  if (priorLead > 0 && /\b(daily|every day)\b/.test(lower)) return true;

  return false;
}

/** Plain-text or JSON reply that continues the thread without resetting. */
export function looksLikeHealthyFollowUp(
  text: string,
  inboundText: string,
  history: HistoryLine[]
): boolean {
  if (looksLikeBrokenFollowUp(text, history)) return false;

  const priorAi = history.filter((h) => h.role === "ai").length;
  if (priorAi === 0) return false;

  const t = text.trim();
  if (t.length < 12 || t.length > MAX_SMS_FOLLOWUP) return false;

  const lower = t.toLowerCase();
  const inboundLower = inboundText.toLowerCase();

  const acknowledgesLead =
    /\b(great|perfect|lovely|nice|sounds good|works|evening|morning|afternoon|thursday|tuesday|wednesday|friday|saturday|sunday|\d{1,2}[.:]?\d{0,2}\s*(am|pm)?)\b/i.test(
      lower
    ) ||
    inboundLower
      .split(/\s+/)
      .filter((w) => w.length > 4)
      .some((w) => lower.includes(w));

  const movesBookingForward =
    /\?/.test(t) ||
    /\b(which (one|day|time)|what time|still good|see you|booked|trial)\b/i.test(
      lower
    );

  return acknowledgesLead && movesBookingForward;
}

/** Drop knowledge chunks that are meta-templates (models copy them verbatim). */
export function filterKnowledgeForReply<T extends { text: string }>(
  chunks: T[]
): T[] {
  return chunks.filter((c) => !/\{firstName\}|\{programme\}|\{branch\}|\{times?\}/i.test(c.text));
}
