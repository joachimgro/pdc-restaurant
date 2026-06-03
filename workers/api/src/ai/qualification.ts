import type { Lead } from "@lead-intake/shared-types";
import type { Env } from "../env";
import { insertDomainEvent } from "../db/events";
import type { AiReply } from "./pipeline";

export interface QualificationData {
  name?: string;
  interest?: string;
  isChild?: boolean;
  childName?: string;
  childAge?: string | number;
}

// ─── Programme knowledge ─────────────────────────────────────────────────────

const PROGRAMME_DESCRIPTIONS: Record<string, string> = {
  BJJ: "ground grappling that uses technique and leverage rather than size or strength — no striking, brilliant for self-defence and building real confidence",
  MMA: "the most complete martial art — combines striking (punches, kicks) with grappling, covering both standup and ground work",
  "Muay Thai": "striking with punches, kicks, elbows and knees — great for fitness and coordination, all pad work, sparring is always optional",
  Kickboxing: "punches and kicks in an upright stance — fitness-focused with bag and pad work, no grappling",
  Wrestling: "takedowns and ground control — a brilliant base for any martial art or general fitness",
  Boxing: "punching technique, footwork and head movement — great cardio and a real skill set",
};

const PROGRAMME_COMPARISON =
  "BJJ = ground grappling, no striking. MMA = striking + grappling combined. Muay Thai = striking with punches, kicks, elbows and knees. Kickboxing = punches and kicks, fitness-focused.";

const PROGRAMME_ALIASES: Record<string, string> = {
  bjj: "BJJ",
  "jiu jitsu": "BJJ",
  "jiu-jitsu": "BJJ",
  "jiu_jitsu": "BJJ",
  "brazilian jiu jitsu": "BJJ",
  mma: "MMA",
  "mixed martial arts": "MMA",
  "muay thai": "Muay Thai",
  muaythai: "Muay Thai",
  thai: "Muay Thai",
  kickboxing: "Kickboxing",
  "kick boxing": "Kickboxing",
  wrestling: "Wrestling",
  boxing: "Boxing",
  karate: "Karate",
  judo: "Judo",
  taekwondo: "Taekwondo",
};

// ─── Name validation ──────────────────────────────────────────────────────────

/** Words that should never be treated as a person's name. */
const NON_NAME_WORDS = new Set([
  // Question / interrogative
  "what", "which", "who", "why", "when", "how", "where",
  // Pronouns / articles
  "i", "my", "me", "we", "our", "you", "your", "they", "them",
  "he", "she", "it", "its", "the", "a", "an",
  // This / that
  "this", "that", "these", "those",
  // Filler
  "yes", "no", "ok", "okay", "sure", "thanks", "thank",
  "hi", "hey", "hello", "just", "well", "so", "and", "or", "but",
  "for", "from", "with", "about", "like", "want", "need", "been",
  "nice", "good", "great", "yeah", "yep", "nope",
  // Common sentence starters that get capitalised
  "can", "could", "would", "please", "do", "does", "is", "are", "was",
  "have", "has", "had", "will", "shall", "might", "may",
  "tell", "show", "give", "help", "let", "make", "take",
  "all", "some", "any", "more", "most", "much", "many",
  "also", "too", "only", "even", "still", "really",
  "difference", "between", "classes", "class",
]);

function isValidName(candidate: string): boolean {
  if (!candidate || candidate.length < 2) return false;
  const lower = candidate.toLowerCase();
  if (NON_NAME_WORDS.has(lower)) return false;
  // Must look like a proper name: starts uppercase, rest lowercase, 2–20 chars
  if (!/^[A-Z][a-z]{1,19}$/.test(candidate)) return false;
  // Shouldn't be a programme keyword
  if (Object.values(PROGRAMME_ALIASES).some((v) => v.toLowerCase() === lower))
    return false;
  return true;
}

// ─── Text signal detection ────────────────────────────────────────────────────

function extractInterest(text: string): string | undefined {
  const lower = text.toLowerCase();
  for (const [key, value] of Object.entries(PROGRAMME_ALIASES)) {
    if (lower.includes(key)) return value;
  }
  return undefined;
}

function extractName(text: string): string | undefined {
  // Strong patterns: "I'm Sarah", "My name is Sarah", "It's Sarah", "Call me Sarah"
  const strongMatch = text.match(
    /(?:i(?:'m| am)|my name(?:'s| is)|it'?s|call me|this is)\s+([A-Z][a-z]{1,19}(?:\s+[A-Z][a-z]{1,19})?)/i
  );
  if (strongMatch) {
    const candidate = strongMatch[1].trim();
    // Validate the first word
    if (isValidName(candidate.split(" ")[0])) return candidate.trim();
  }

  // Weak fallback: standalone capitalised token (e.g. just "Joachim")
  // Only use if the message is short and looks like just a name
  const words = text.trim().split(/\s+/);
  if (words.length <= 3) {
    for (const word of words) {
      const clean = word.replace(/[^A-Za-z]/g, "");
      if (isValidName(clean)) return clean;
    }
  }

  return undefined;
}

function extractChild(text: string): Pick<QualificationData, "isChild" | "childName" | "childAge"> {
  const result: Pick<QualificationData, "isChild" | "childName" | "childAge"> = {};

  const childSignal = /\b(my (son|daughter|kid|child|boy|girl)|for (him|her|them)|(he|she)('s| is))\b/i;
  if (childSignal.test(text)) result.isChild = true;

  const childNameMatch = text.match(
    /(?:son|daughter|kid|child|boy|girl)\s+([A-Z][a-z]+)/
  );
  if (childNameMatch && isValidName(childNameMatch[1])) {
    result.childName = childNameMatch[1];
    result.isChild = true;
  }

  const ageMatch = text.match(
    /(?:(?:he|she|they)(?:'s| is| are)|aged?|age)\s*(\d+)|(\d+)\s*years?\s*old/i
  );
  if (ageMatch) {
    const parsed = parseInt(ageMatch[1] ?? ageMatch[2] ?? "0", 10);
    if (parsed > 0) result.childAge = parsed;
  }

  return result;
}

/** Detect whether the message is asking about a specific programme ("what is BJJ?"). */
function detectWhatIsQuestion(text: string): string | null {
  const match = text.match(
    /\bwhat(?:'?s| is)\b.{0,30}\b(bjj|mma|muay thai|kickboxing|wrestling|boxing|jiu.?jitsu|martial art)\b/i
  );
  if (!match) return null;
  const keyword = match[1].toLowerCase();
  for (const [alias, canonical] of Object.entries(PROGRAMME_ALIASES)) {
    if (alias === keyword || canonical.toLowerCase() === keyword) return canonical;
  }
  return null;
}

/** Detect whether the message asks to compare programmes. */
function detectComparisonQuestion(text: string): boolean {
  return /\b(difference|compare|vs\.?|versus|between|better|which.{0,20}(should|would)|what.{0,20}(suit|right|best for me))\b/i.test(
    text
  );
}

// ─── Parse ────────────────────────────────────────────────────────────────────

export function parseQualificationReply(text: string): QualificationData {
  return {
    name: extractName(text),
    interest: extractInterest(text),
    ...extractChild(text),
  };
}

// ─── DB update ────────────────────────────────────────────────────────────────

export async function applyQualificationUpdate(
  env: Env,
  leadId: string,
  data: QualificationData
): Promise<void> {
  const sets: string[] = ["updated_at = datetime('now')"];
  const binds: unknown[] = [];

  if (data.name) {
    sets.push("name = ?");
    binds.push(data.name);
  }
  if (data.interest) {
    sets.push("interest = ?");
    binds.push(data.interest);
  }
  if (data.isChild && (data.childName || data.childAge)) {
    const childJson = JSON.stringify({
      name: data.childName ?? "—",
      age: data.childAge ?? "—",
      experience: "First-timer",
    });
    sets.push("child_json = COALESCE(child_json, ?)");
    binds.push(childJson);
  }

  if (sets.length > 1) {
    binds.push(leadId);
    await env.DB.prepare(`UPDATE leads SET ${sets.join(", ")} WHERE id = ?`)
      .bind(...binds)
      .run();

    await insertDomainEvent(env.DB, env.ORGANIZATION_ID, {
      type: "lead.updated",
      payload: { leadId, patch: { name: data.name, interest: data.interest } },
    });
  }
}

// ─── Qualification check ──────────────────────────────────────────────────────

export function needsQualification(lead: Lead): boolean {
  if (lead.interest && lead.interest !== "Unknown") return false;
  const source = (lead.source ?? "").toLowerCase();
  return source === "sms" || source === "telnyx" || source === "inbound";
}

function priorAiCount(history: { role: string }[]): number {
  return history.filter((h) => h.role === "ai").length;
}

/** Pull whatever name was already saved on the lead (if it looks real). */
function savedName(lead: Lead): string | undefined {
  const n = lead.name?.trim();
  if (!n) return undefined;
  // If name looks like a phone number, it's the default placeholder — not a real name
  if (/^\+?\d[\d\s\-]{6,}$/.test(n)) return undefined;
  // If it's a slug like "sms-12345678"
  if (/^sms-/i.test(n)) return undefined;
  return n.split(" ")[0]; // first name only
}

// ─── Reply builder ────────────────────────────────────────────────────────────

function buildQualificationReply(
  parsed: QualificationData,
  existingName: string | undefined,
  inboundText: string
): string {
  const name = parsed.name ?? existingName;
  const interest = parsed.interest;
  const greeting = name ? `Hey ${name}!` : "Hey!";

  const whatIs = detectWhatIsQuestion(inboundText);
  const isComparison = detectComparisonQuestion(inboundText);

  // Prefix: answer any question they asked first
  let prefix = "";
  if (whatIs && PROGRAMME_DESCRIPTIONS[whatIs]) {
    prefix = `${whatIs} is ${PROGRAMME_DESCRIPTIONS[whatIs]}. `;
  } else if (isComparison) {
    prefix = `${PROGRAMME_COMPARISON} `;
  }

  // Now work out what we still need
  const needsName = !name;
  const needsInterest = !interest;

  if (!needsName && !needsInterest) {
    // We have everything — move to booking
    const who = parsed.childName ?? (parsed.isChild ? "your child" : name!);
    if (parsed.isChild) {
      return `${prefix}${greeting} So we're looking at ${interest} for ${who} — brilliant! Which days work best for a free trial?`;
    }
    return `${prefix}${greeting} ${interest} is a brilliant choice — great for beginners too. Which days work best for a free trial?`;
  }

  if (!needsName && needsInterest) {
    // Have name, still need interest
    const programmeQ = "Which class takes your fancy — BJJ, MMA, Muay Thai or Kickboxing?";
    if (prefix) return `${prefix}${greeting} ${programmeQ}`;
    return `${greeting} Which class are you interested in — BJJ, MMA, Muay Thai or Kickboxing?`;
  }

  if (needsName && !needsInterest) {
    // Have interest, still need name
    const nameQ = "And what's your name?";
    if (prefix) return `${prefix}Happy to help with ${interest}! ${nameQ}`;
    return `${interest} is a great shout! ${nameQ}`;
  }

  // Need both
  if (prefix) {
    return `${prefix}Happy to help! What's your name and which one takes your fancy?`;
  }

  // First ask — nothing provided yet
  const isGreeting =
    inboundText.trim().length < 20 &&
    /^(hi|hey|hello|yo|morning|afternoon|evening|hiya|howdy|sup|ello)/i.test(
      inboundText.trim()
    );

  if (isGreeting) {
    return `Hey! Happy to help — what's your name and which class are you interested in? We do BJJ, MMA, Muay Thai and Kickboxing.`;
  }

  return `Happy to help! Quick one — what's your name and which class are you after? (BJJ, MMA, Muay Thai or Kickboxing.)`;
}

// ─── Main handler ─────────────────────────────────────────────────────────────

export async function handleQualificationTurn(
  env: Env,
  lead: Lead,
  inboundText: string,
  history: { role: "lead" | "ai" | "staff"; text: string }[]
): Promise<AiReply | null> {
  if (!needsQualification(lead)) return null;

  const aiCount = priorAiCount(history);
  const existing = savedName(lead);

  // Always parse — even message 1 might contain name/interest
  const parsed = parseQualificationReply(inboundText);

  // Persist anything we extracted
  if (parsed.name || parsed.interest) {
    await applyQualificationUpdate(env, lead.id, parsed);
  }

  const name = parsed.name ?? existing;
  const interest = parsed.interest;

  const gotEnough = name && interest;

  // After two failed attempts, let the LLM take over
  if (aiCount >= 2 && !gotEnough) return null;

  const text = buildQualificationReply(parsed, existing, inboundText);

  const stage = gotEnough ? "Qualifying" : "Discovery";
  const assessment = gotEnough
    ? `Qualified — ${interest} enquiry`
    : aiCount === 0
      ? "Qualifying — awaiting name and interest"
      : !name
        ? "Qualifying — awaiting name"
        : "Qualifying — awaiting interest";

  return {
    text,
    reasoning: {
      verdict: "Approved",
      stage,
      note: `Qualification turn ${aiCount + 1} — name: ${name ?? "pending"}, interest: ${interest ?? "pending"}.`,
    },
    assessment,
    preview: text.slice(0, 53) + (text.length > 53 ? "..." : ""),
    status: gotEnough ? "engaged" : "new",
    statusLabel: gotEnough ? "Engaged" : "New",
  };
}
