import type { Lead } from "@lead-intake/shared-types";
import type { Env } from "../env";
import { insertDomainEvent } from "../db/events";
import { getLocationNameById, resolveLocationIdFromText } from "../db/locations";
import { nowTimeLabel, updateLeadFields } from "../db/leads";
import {
  extractProgrammeFromText,
  inferProgrammeFromHistory,
  isUnknownInterest,
  resolveProgrammeLabel,
} from "./programme-resolve";
import type { AiReply } from "./pipeline";

export interface QualificationData {
  name?: string;
  interest?: string;
  locationId?: string;
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
    if (isValidName(candidate.split(" ")[0])) return candidate.trim();
  }

  // Name-first pattern: "Joachim and probs mma", "Sarah, I wanted to ask..."
  // Matches a proper name immediately followed by comma, "and", "or", "here", "but"
  const nameFirstMatch = text.trim().match(
    /^([A-Z][a-z]{1,19})(?:\s*[,!]|\s+(?:and|or|here|but|so)\b)/
  );
  if (nameFirstMatch && isValidName(nameFirstMatch[1])) {
    return nameFirstMatch[1];
  }

  // Short message fallback: 1–3 words, first valid name wins (e.g. "Abigail Petts")
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

/** Detect whether the message asks which locations we have. */
function detectLocationQuestion(text: string): boolean {
  // "which one" alone is too generic — must have a location-type word nearby
  return /\b(which\s+(location|branch|gym|place)|where\s+(are\s+you|do\s+you|is\s+that|is\s+it)|what\s+(location|branch|area)|near\s+(me|us)|closest\s+branch|nearest\s+branch|where.{0,20}(based|located)|do\s+you\s+have.{0,20}(branch|location|gym))\b/i.test(
    text
  );
}

/** Detect goal/motivation questions — undecided leads asking what's right for them. */
function detectGoalQuestion(text: string): boolean {
  return /\b(beginner.{0,20}friendly|easiest|best\s+(for|to)\s+start|where\s+do\s+i\s+start|don'?t\s+know\s+which|not\s+sure\s+which|which\s+(should|would)|what'?s\s+(best|right|good)\s+for\s+(me|a\s+beginner)|help\s+me\s+(choose|decide|pick)|what\s+(do\s+you\s+recommend|would\s+you\s+suggest)|goal|trying\s+to\s+get|looking\s+to\s+(get\s+fit|lose|build|learn|improve)|good\s+for\s+(fitness|self.defence|confidence|weight))\b/i.test(
    text
  );
}

const GOAL_QUESTION = "What are you looking to get out of it — get fitter, learn self-defence, build confidence, or just try something new? That'll help me point you in the right direction.";

/** Goal → best programme recommendation. */
function goalRecommendation(text: string): string | null {
  const t = text.toLowerCase();
  if (/\b(self.defenc|defend|protect|street|real.?world|practical)\b/.test(t)) {
    return "For self-defence, BJJ or MMA are the strongest options — BJJ teaches control and submissions, MMA adds striking on top. Both are practical and tested. Which appeals more?";
  }
  if (/\b(fit|cardio|weight|lose|burn|healthy|tone|energy|shape)\b/.test(t)) {
    return "For fitness, all our classes work really well — but Muay Thai and Kickboxing give you the highest-intensity cardio, while BJJ builds strength in a more technique-led way. Fancy trying one?";
  }
  if (/\b(confiden|mental|focus|discipline|stress|wellbeing|calm)\b/.test(t)) {
    return "Lots of our members come in for the mental side — discipline, focus, stress relief. BJJ is especially good for this — it's almost like a physical chess game. Want to give it a go?";
  }
  if (/\b(kids?|child|son|daughter|boy|girl)\b/.test(t)) {
    return "For kids, BJJ is brilliant — it builds confidence, discipline and coordination without any striking. We have kids classes at most branches. How old are they?";
  }
  return null;
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
  const timelineParts: { bold: string; text: string }[] = [];

  if (data.name) {
    sets.push("name = ?");
    binds.push(data.name);
    timelineParts.push({ bold: "Name added", text: ` · ${data.name}` });
  }
  if (data.interest) {
    sets.push("interest = ?");
    binds.push(data.interest);
    timelineParts.push({ bold: "Interest", text: ` · ${data.interest}` });
  }
  if (data.locationId) {
    sets.push("location_id = ?");
    binds.push(data.locationId);
    sets.push("location_confirmed = 1");
    const locName = await getLocationNameById(env, data.locationId);
    timelineParts.push({ bold: "Location confirmed", text: ` · ${locName}` });
  }
  if (data.isChild && (data.childName || data.childAge)) {
    const childJson = JSON.stringify({
      name: data.childName ?? "—",
      age: data.childAge ?? "—",
      experience: "First-timer",
    });
    sets.push("child_json = COALESCE(child_json, ?)");
    binds.push(childJson);
    const childDesc = [data.childName, data.childAge ? `age ${data.childAge}` : null]
      .filter(Boolean).join(", ");
    timelineParts.push({ bold: "Child added", text: ` · ${childDesc}` });
  }

  if (sets.length > 1) {
    binds.push(leadId);
    await env.DB.prepare(`UPDATE leads SET ${sets.join(", ")} WHERE id = ?`)
      .bind(...binds)
      .run();

    // Insert one timeline event per fact (avoids them running together in the UI)
    if (timelineParts.length > 0) {
      const sortRow = await env.DB.prepare(
        `SELECT COALESCE(MAX(sort_order), -1) + 1 as n FROM timeline_events WHERE lead_id = ?`
      ).bind(leadId).first<{ n: number }>();
      let sortOrder = sortRow?.n ?? 1;

      const batchTime = nowTimeLabel();
      const stmts = timelineParts.map((part) =>
        env.DB.prepare(
          `INSERT INTO timeline_events (id, lead_id, sort_order, time_label, parts_json)
           VALUES (?, ?, ?, ?, ?)`
        ).bind(
          crypto.randomUUID(),
          leadId,
          sortOrder++,
          batchTime,
          JSON.stringify([part])
        )
      );
      await env.DB.batch(stmts);
    }

    await insertDomainEvent(env.DB, env.ORGANIZATION_ID, {
      type: "lead.updated",
      payload: {
        leadId,
        patch: {
          name: data.name,
          interest: data.interest,
          locationId: data.locationId,
        },
      },
    });
  }
}

// ─── Qualification check ──────────────────────────────────────────────────────

export function needsQualification(lead: Lead): boolean {
  const source = (lead.source ?? "").toLowerCase();
  const isSmsLead = source === "sms" || source === "telnyx" || source === "inbound";
  if (!isSmsLead) return false;
  // Still qualifying if missing interest OR location not yet confirmed
  const missingInterest = !lead.interest || lead.interest === "Unknown";
  const missingLocation = lead.locationConfirmed === false;
  return missingInterest || missingLocation;
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
  inboundText: string,
  lead: Lead,
  locationName: string,
  resolvedInterest: string | undefined,
  locationConfirmed: boolean
): string {
  const name = parsed.name ?? existingName;
  const interest = resolvedInterest;
  const greeting = name ? `Hey ${name}!` : "Hey!";

  const whatIs = detectWhatIsQuestion(inboundText);
  const isComparison = detectComparisonQuestion(inboundText);
  const isGoalQ = detectGoalQuestion(inboundText);

  const needsName = !name;
  const needsInterest = !interest;
  const needsLocation = !locationConfirmed;

  // Did they just confirm location in this very message?
  const justConfirmedLocation = !!parsed.locationId;

  // ── Answer their question first ────────────────────────────────────────────

  // Goal question (beginner-friendly, what's right for me?) — consult before pushing class choice
  if (isGoalQ && needsInterest) {
    const goalRec = goalRecommendation(inboundText);
    if (goalRec) {
      // Give a direct recommendation
      const nameAck = name ? `${greeting} ` : "";
      const locAck = justConfirmedLocation ? `${locationName} is a great branch! ` : "";
      const nameMissing = needsName ? " And what's your name?" : "";
      return `${nameAck}${locAck}${goalRec}${nameMissing}`;
    }
    // No specific goal detected — ask consultatively
    const nameAck = name ? `${greeting} ` : "";
    const locAck = justConfirmedLocation ? `${locationName} is great! ` : "";
    const nameMissing = needsName ? " And what's your name?" : "";
    return `${nameAck}${locAck}${GOAL_QUESTION}${nameMissing}`;
  }

  // Specific programme question
  let prefix = "";
  if (whatIs && PROGRAMME_DESCRIPTIONS[whatIs]) {
    prefix = `${whatIs} is ${PROGRAMME_DESCRIPTIONS[whatIs]}. `;
  } else if (isComparison) {
    prefix = `${PROGRAMME_COMPARISON} `;
  }

  // Location acknowledgement — if they just told us, say so warmly
  const locAck = justConfirmedLocation ? `${locationName} — great! ` : "";

  // ── State machine replies ──────────────────────────────────────────────────

  // Fully qualified — move to booking
  if (!needsName && !needsInterest && !needsLocation) {
    const who = parsed.childName ?? (parsed.isChild ? "your child" : name!);
    if (parsed.isChild) {
      return `${prefix}${locAck}${greeting} So ${interest} for ${who} at our ${locationName} branch — brilliant! Which days work best for a free trial?`;
    }
    return `${prefix}${locAck}${greeting} ${interest} at our ${locationName} branch — great choice. Which days work best for a free trial?`;
  }

  // Have name + interest, need location
  if (!needsName && !needsInterest && needsLocation) {
    return `${prefix}${greeting} We've got ${interest} at our Manchester, Leeds, Bolton and Stockport branches — which is closest to you?`;
  }

  // Have name + location, need interest — be consultative
  if (!needsName && !needsLocation && needsInterest) {
    if (prefix) return `${prefix}${locAck}${greeting} Which class takes your fancy — BJJ, MMA, Muay Thai or Kickboxing?`;
    return `${locAck}${greeting} ${GOAL_QUESTION}`;
  }

  // Have interest + location, need name
  if (!needsInterest && !needsLocation && needsName) {
    if (prefix) return `${prefix}${locAck}Happy to help with ${interest} at ${locationName}! What's your name?`;
    return `${locAck}${interest} at ${locationName} — great shout! What's your name?`;
  }

  // Have name, need both interest and location
  if (!needsName && needsInterest && needsLocation) {
    if (prefix) return `${prefix}${greeting} Which class are you after, and which branch is nearest — Manchester, Leeds, Bolton or Stockport?`;
    return `${greeting} Two quick ones — ${GOAL_QUESTION.replace("What are", "what are")} And which of our branches is closest — Manchester, Leeds, Bolton or Stockport?`;
  }

  // Have interest only, need name + location
  if (needsName && !needsInterest && needsLocation) {
    if (prefix) return `${prefix}Happy to help with ${interest}! What's your name and which branch — Manchester, Leeds, Bolton or Stockport?`;
    return `${interest} is a great shout! What's your name and which of our branches is nearest to you?`;
  }

  // Have location only, need name + interest
  if (needsName && needsInterest && !needsLocation) {
    if (prefix) return `${prefix}${locAck}Happy to help — what's your name and which class are you after?`;
    return `${locAck}Happy to help at ${locationName}! What's your name and which class are you thinking — BJJ, MMA, Muay Thai or Kickboxing?`;
  }

  // Need everything — prefix answers a question they asked
  if (prefix) {
    return `${prefix}Happy to help! What's your name, which class, and which branch — Manchester, Leeds, Bolton or Stockport?`;
  }

  const isGreeting =
    inboundText.trim().length < 20 &&
    /^(hi|hey|hello|yo|morning|afternoon|evening|hiya|howdy|sup|ello)/i.test(
      inboundText.trim()
    );

  if (isGreeting) {
    return `Hey! Happy to help — what's your name and which class are you interested in? We're in Manchester, Leeds, Bolton and Stockport.`;
  }

  return `Happy to help! Quick one — what's your name, which class (BJJ, MMA, Muay Thai or Kickboxing), and which branch is nearest?`;
}

// ─── Universal profile learning ───────────────────────────────────────────────

/**
 * Run on EVERY inbound message (not just during qualification).
 * Extracts name / child info / interest from the text and persists to DB
 * only when the lead's current record is missing that data.
 * Returns true if anything was updated.
 */
export async function learnFromMessage(
  env: Env,
  lead: Lead,
  inboundText: string,
  history: { role: string; text: string }[] = []
): Promise<boolean> {
  const parsed = parseQualificationReply(inboundText);
  const patch: QualificationData = {};

  // Name: update only if the current stored name looks like a placeholder
  const currentName = lead.name?.trim() ?? "";
  const nameIsPlaceholder =
    !currentName ||
    /^\+?\d[\d\s\-]{5,}$/.test(currentName) ||
    /^sms-/i.test(currentName) ||
    /^(unknown|lead|user|customer|new)$/i.test(currentName);

  if (parsed.name && nameIsPlaceholder) {
    patch.name = parsed.name;
  }

  // Interest: update only if currently Unknown
  if (isUnknownInterest(lead.interest)) {
    if (parsed.interest) {
      patch.interest = parsed.interest;
    } else if (history.length > 0) {
      const fromHistory = inferProgrammeFromHistory(history);
      if (fromHistory) patch.interest = fromHistory;
    }
  }

  // Child info: update only if not already recorded
  if (parsed.isChild && !lead.child) {
    patch.isChild = parsed.isChild;
    patch.childName = parsed.childName;
    patch.childAge = parsed.childAge;
  }

  const hasUpdates =
    !!patch.name || !!patch.interest || !!patch.isChild;

  if (hasUpdates) {
    await applyQualificationUpdate(env, lead.id, patch);
  }

  return hasUpdates;
}

/** Persist inferred programme when the lead record still says Unknown. */
export async function ensureLeadProgramme(
  env: Env,
  leadId: string,
  lead: Pick<Lead, "interest">,
  opts?: {
    schedule?: import("../db/location-schedules").ProgrammeSchedule | null;
    history?: { role: string; text: string }[];
  }
): Promise<string | undefined> {
  const label = resolveProgrammeLabel(lead, opts);
  if (label && isUnknownInterest(lead.interest)) {
    await applyQualificationUpdate(env, leadId, { interest: label });
  }
  return label ?? (isUnknownInterest(lead.interest) ? undefined : lead.interest);
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

  // Always parse — even message 1 might contain name/interest/location
  const parsed = parseQualificationReply(inboundText);
  const parsedLocationId = await resolveLocationIdFromText(env, inboundText);

  // Only update with confirmed location if it changed from the unconfirmed default
  const locationChanged =
    parsedLocationId && parsedLocationId !== lead.locationId;
  if (parsed.name || parsed.interest || locationChanged || parsed.isChild) {
    await applyQualificationUpdate(env, lead.id, {
      ...parsed,
      locationId: locationChanged ? parsedLocationId : undefined,
    });
  }

  const name = parsed.name ?? existing;
  const interest = parsed.interest ?? (lead.interest !== "Unknown" ? lead.interest : undefined);
  const locationConfirmed = lead.locationConfirmed !== false || !!parsedLocationId;
  const locationId = parsedLocationId ?? lead.locationId;
  const locationName = locationId
    ? await getLocationNameById(env, locationId)
    : lead.location;

  const gotEnough = !!(name && interest && locationConfirmed);

  // After two failed attempts with nothing, let the LLM take over
  if (aiCount >= 2 && !gotEnough) return null;

  const text = buildQualificationReply(parsed, existing, inboundText, lead, locationName, interest, locationConfirmed);

  // Save programme when we recommended one (e.g. Muay Thai for fitness) but lead never named a class
  const inferredFromReply = extractProgrammeFromText(text);
  if (inferredFromReply && isUnknownInterest(lead.interest)) {
    await applyQualificationUpdate(env, lead.id, { interest: inferredFromReply });
  }

  const missingParts = [
    !name && "name",
    !interest && "interest",
    !locationConfirmed && "location",
  ].filter(Boolean).join(", ");

  const stage = gotEnough ? "Qualifying" : "Discovery";
  const assessment = gotEnough
    ? `Qualified — ${interest} enquiry`
    : `Qualifying — awaiting ${missingParts}`;

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
