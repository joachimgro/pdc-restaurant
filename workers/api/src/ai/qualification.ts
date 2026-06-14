import type { Lead } from "@lead-intake/shared-types";
import type { Env } from "../env";
import { insertDomainEvent } from "../db/events";
import { getLocationNameById, resolveLocationIdFromText } from "../db/locations";
import { nowTimeLabel, updateLeadFields } from "../db/leads";
import {
  buildTemplateParams,
  getProgrammeAliases,
  getQualificationConfig,
  getEffectiveRequiredFields,
  type QualificationField,
} from "../db/ai-qualification-config";
import { renderTemplate } from "./template-render";
import { looksLikeQuestion } from "./question-detect";
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

// ─── Name validation ──────────────────────────────────────────────────────────

const NON_NAME_WORDS = new Set([
  "what", "which", "who", "why", "when", "how", "where",
  "i", "my", "me", "we", "our", "you", "your", "they", "them",
  "he", "she", "it", "its", "the", "a", "an",
  "shes", "she's", "hes", "he's", "theyre", "they're", "its",
  "this", "that", "these", "those",
  "yes", "no", "ok", "okay", "sure", "thanks", "thank",
  "hi", "hey", "hello", "just", "well", "so", "and", "or", "but",
  "for", "from", "with", "about", "like", "want", "need", "been",
  "nice", "good", "great", "yeah", "yep", "nope",
  "can", "could", "would", "please", "do", "does", "is", "are", "was",
  "have", "has", "had", "will", "shall", "might", "may",
  "tell", "show", "give", "help", "let", "make", "take",
  "all", "some", "any", "more", "most", "much", "many",
  "also", "too", "only", "even", "still", "really",
  "difference", "between", "classes", "class",
]);

function isValidName(candidate: string, aliasValues: string[]): boolean {
  if (!candidate || candidate.length < 2) return false;
  const lower = candidate.toLowerCase();
  if (NON_NAME_WORDS.has(lower)) return false;
  if (!/^[A-Z][a-z]{1,19}$/.test(candidate)) return false;
  if (aliasValues.some((v) => v.toLowerCase() === lower)) return false;
  return true;
}

function extractInterest(
  text: string,
  aliases: Record<string, string>
): string | undefined {
  return extractProgrammeFromText(text, aliases);
}

function isPronounAgeReply(text: string): boolean {
  const t = text.trim();
  return (
    /^(she|he|they)['']?s?\s+\d/i.test(t) ||
    /^(she|he|they)\s+is\s+\d/i.test(t) ||
    /^(year|yr)\s*\d{1,2}\b/i.test(t) ||
    /^\d{1,2}$/.test(t) ||
    /^age\s*\d+/i.test(t)
  );
}

export type ParseQualificationContext = {
  /** Parent name already captured — do not re-extract from child-age replies */
  parentNameEstablished?: boolean;
  /** Last AI turn asked for child age/year */
  awaitingChildDetails?: boolean;
  /** Tuition-style enquiry on behalf of a child */
  childEnquiry?: boolean;
};

function extractChild(
  text: string,
  ctx?: ParseQualificationContext
): Pick<QualificationData, "isChild" | "childName" | "childAge"> {
  const result: Pick<QualificationData, "isChild" | "childName" | "childAge"> = {};

  const childSignal =
    /\b(my (son|daughter|kid|child|boy|girl)|for (him|her|them)|my daughter|my son)\b/i;
  if (childSignal.test(text)) result.isChild = true;

  const childNameMatch = text.match(
    /(?:son|daughter|kid|child|boy|girl)\s+([A-Z][a-z]+)/
  );
  if (childNameMatch && isValidName(childNameMatch[1], [])) {
    result.childName = childNameMatch[1];
    result.isChild = true;
  }

  const pronounAge = text.match(
    /\b(?:she|he|they)['']?s?\s+(\d{1,2})\b/i
  );
  if (pronounAge) {
    const n = parseInt(pronounAge[1], 10);
    if (n > 0 && n < 25) {
      result.childAge = n;
      result.isChild = true;
    }
  }

  const yearGroup = text.match(/\b(?:year|yr)\s*(\d{1,2})\b/i);
  if (yearGroup) {
    result.childAge = `Year ${yearGroup[1]}`;
    result.isChild = true;
  }

  const ageMatch = text.match(
    /(?:aged?|age)\s*(\d{1,2})\b|(\d{1,2})\s*years?\s*old/i
  );
  if (ageMatch) {
    const parsed = parseInt(ageMatch[1] ?? ageMatch[2] ?? "0", 10);
    if (parsed > 0 && parsed < 25) {
      result.childAge = parsed;
      result.isChild = true;
    }
  }

  if (ctx?.awaitingChildDetails && /^\d{1,2}$/.test(text.trim())) {
    const n = parseInt(text.trim(), 10);
    if (n > 0 && n < 25) {
      result.childAge = n;
      result.isChild = true;
    }
  }

  return result;
}

function extractName(
  text: string,
  aliasValues: string[],
  ctx?: ParseQualificationContext
): string | undefined {
  if (ctx?.awaitingChildDetails || isPronounAgeReply(text)) {
    return undefined;
  }

  if (ctx?.parentNameEstablished && ctx?.childEnquiry) {
    const strongMatch = text.match(
      /(?:i(?:'m| am)|my name(?:'s| is)|call me|this is)\s+([A-Z][a-z]{1,19}(?:\s+[A-Z][a-z]{1,19})?)/i
    );
    if (strongMatch) {
      const candidate = strongMatch[1].trim();
      if (isValidName(candidate.split(" ")[0], aliasValues))
        return candidate.trim();
    }
    return undefined;
  }

  const strongMatch = text.match(
    /(?:i(?:'m| am)|my name(?:'s| is)|it'?s|call me|this is)\s+([A-Z][a-z]{1,19}(?:\s+[A-Z][a-z]{1,19})?)/i
  );
  if (strongMatch) {
    const candidate = strongMatch[1].trim();
    if (isValidName(candidate.split(" ")[0], aliasValues)) return candidate.trim();
  }

  const nameFirstMatch = text.trim().match(
    /^([A-Z][a-z]{1,19})(?:\s*[,!]|\s+(?:and|or|here|but|so|i)\b)/
  );
  if (nameFirstMatch && isValidName(nameFirstMatch[1], aliasValues)) {
    return nameFirstMatch[1];
  }

  const words = text.trim().split(/\s+/);
  if (words.length <= 3 && !ctx?.childEnquiry) {
    for (const word of words) {
      const clean = word.replace(/[^A-Za-z]/g, "");
      if (isValidName(clean, aliasValues)) return clean;
    }
  }

  return undefined;
}

export function parseQualificationReply(
  text: string,
  aliases: Record<string, string> = {},
  ctx?: ParseQualificationContext
): QualificationData {
  const aliasValues = [...new Set(Object.values(aliases))];
  return {
    name: extractName(text, aliasValues, ctx),
    interest: extractInterest(text, aliases),
    ...extractChild(text, ctx),
  };
}

export function isAwaitingChildDetailsInHistory(
  history: { role: string; text: string }[]
): boolean {
  const lastAi = [...history].reverse().find((h) => h.role === "ai");
  if (!lastAi) return false;
  return /\b(how old|what year|year are they|year is (your |they|she|he))/i.test(
    lastAi.text
  );
}

export function buildParseContext(
  lead: Lead,
  history: { role: string; text: string }[],
  requiredFields: QualificationField[]
): ParseQualificationContext {
  const childEnquiry =
    requiredFields.includes("child") ||
    !!lead.child ||
    history.some(
      (h) =>
        h.role === "lead" &&
        /\b(my (son|daughter|kid|child)|for my (son|daughter))\b/i.test(h.text)
    );
  const parentNameEstablished = !!savedName(lead);
  const awaitingChildDetails =
    childEnquiry &&
    parentNameEstablished &&
    isAwaitingChildDetailsInHistory(history);

  return { childEnquiry, parentNameEstablished, awaitingChildDetails };
}

function childDetailsMissing(lead: Lead): boolean {
  if (!lead.child) return true;
  const age = lead.child.age;
  if (age === undefined || age === null || age === "" || age === "—") return true;
  return false;
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
  if (data.isChild || data.childAge != null || data.childName) {
    const existingRow = await env.DB.prepare(
      `SELECT child_json FROM leads WHERE id = ?`
    )
      .bind(leadId)
      .first<{ child_json: string | null }>();

    let child = {
      name: "—",
      age: "—" as string | number,
      experience: "First-timer",
    };
    if (existingRow?.child_json) {
      try {
        child = { ...child, ...JSON.parse(existingRow.child_json) };
      } catch {
        /* keep defaults */
      }
    }
    if (data.childName) child.name = data.childName;
    if (data.childAge != null) child.age = data.childAge;

    const childJson = JSON.stringify(child);
    sets.push("child_json = ?");
    binds.push(childJson);
    const childDesc = [
      child.name !== "—" ? child.name : null,
      child.age !== "—" ? `age ${child.age}` : null,
    ]
      .filter(Boolean)
      .join(", ");
    timelineParts.push({
      bold: existingRow?.child_json ? "Child updated" : "Child added",
      text: ` · ${childDesc || "details captured"}`,
    });
  }

  if (sets.length > 1) {
    binds.push(leadId);
    await env.DB.prepare(`UPDATE leads SET ${sets.join(", ")} WHERE id = ?`)
      .bind(...binds)
      .run();

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

function isSmsLead(lead: Lead): boolean {
  const source = (lead.source ?? "").toLowerCase();
  return source === "sms" || source === "telnyx" || source === "inbound";
}

function fieldMissing(lead: Lead, field: QualificationField, name?: string): boolean {
  switch (field) {
    case "name": {
      const n = name ?? lead.name?.trim();
      if (!n) return true;
      if (/^\+?\d[\d\s\-]{6,}$/.test(n)) return true;
      if (/^sms-/i.test(n)) return true;
      return false;
    }
    case "interest":
      return !lead.interest || lead.interest === "Unknown";
    case "location":
      return lead.locationConfirmed === false;
    case "child":
      return childDetailsMissing(lead);
    default:
      return false;
  }
}

export function needsQualification(
  lead: Lead,
  requiredFields: QualificationField[] = ["interest", "location"]
): boolean {
  if (!isSmsLead(lead)) return false;
  return requiredFields.some((f) => fieldMissing(lead, f));
}

function priorAiCount(history: { role: string }[]): number {
  return history.filter((h) => h.role === "ai").length;
}

function savedName(lead: Lead): string | undefined {
  const n = lead.name?.trim();
  if (!n) return undefined;
  if (/^\+?\d[\d\s\-]{6,}$/.test(n)) return undefined;
  if (/^sms-/i.test(n)) return undefined;
  return n.split(" ")[0];
}

async function buildQualificationReply(
  env: Env,
  parsed: QualificationData,
  existingName: string | undefined,
  inboundText: string,
  lead: Lead,
  locationName: string,
  resolvedInterest: string | undefined,
  locationConfirmed: boolean,
  requiredFields: QualificationField[],
  hasChild: boolean
): Promise<string> {
  const config = await getQualificationConfig(env);
  const params = await buildTemplateParams(env, {
    firstName: existingName ?? parsed.name,
    interest: resolvedInterest,
    locationName,
  });
  const templates = config.templates;

  const name = existingName ?? parsed.name;
  const interest = resolvedInterest;
  const needsName = fieldMissing(lead, "name", name);
  const needsInterest = !interest;
  const needsLocation =
    requiredFields.includes("location") && !locationConfirmed;
  const needsChild = requiredFields.includes("child") && !hasChild;

  if (!needsName && !needsInterest && !needsLocation && !needsChild) {
    return renderTemplate(templates.qualified ?? DEFAULT_QUALIFIED, params);
  }

  const isGreeting =
    inboundText.trim().length < 20 &&
    /^(hi|hey|hello|yo|morning|afternoon|evening|hiya|howdy|sup|ello)/i.test(
      inboundText.trim()
    );

  if (isGreeting && (needsName || needsInterest)) {
    return renderTemplate(templates.greeting ?? templates.need_all, params);
  }

  if (needsChild && !needsName && !needsInterest && !needsLocation) {
    return renderTemplate(
      templates.need_child ??
        "Thanks{{first_name}}! How old is your child, or what year are they in?",
      params
    );
  }

  if (needsName && needsInterest && needsLocation) {
    return renderTemplate(templates.need_all, params);
  }
  if (needsName && needsInterest) {
    return renderTemplate(templates.need_name_and_interest, params);
  }
  if (needsName && needsLocation) {
    return renderTemplate(
      templates.need_name_and_interest ?? templates.need_name,
      params
    );
  }
  if (needsInterest && needsLocation) {
    return renderTemplate(
      templates.need_all ?? templates.need_interest,
      params
    );
  }
  if (needsName && needsChild) {
    return renderTemplate(templates.need_all ?? templates.need_name, params);
  }
  if (needsName) {
    return renderTemplate(templates.need_name, params);
  }
  if (needsInterest) {
    return renderTemplate(templates.need_interest, params);
  }
  if (needsLocation) {
    return renderTemplate(templates.need_location, params);
  }
  if (needsChild) {
    return renderTemplate(
      templates.need_child ??
        "Thanks{{first_name}}! How old is your child, or what year are they in?",
      params
    );
  }

  return renderTemplate(templates.greeting ?? templates.need_all, params);
}

const DEFAULT_QUALIFIED =
  "Great{{first_name}}! {{interest}} at {{location_name}} — which days work best for a {{trial_label}}?";

function childDetailsSatisfied(
  lead: Lead,
  parsed: QualificationData,
  required: boolean
): boolean {
  if (!required) return true;
  if (parsed.childAge != null) return true;
  if (!childDetailsMissing(lead)) return true;
  return false;
}

export async function learnFromMessage(
  env: Env,
  lead: Lead,
  inboundText: string,
  history: { role: string; text: string }[] = []
): Promise<boolean> {
  const config = await getQualificationConfig(env);
  const requiredFields = getEffectiveRequiredFields(env, config.requiredFields);
  const parseCtx = buildParseContext(lead, history, requiredFields);
  const aliases = await getProgrammeAliases(env);
  const parsed = parseQualificationReply(inboundText, aliases, parseCtx);
  const patch: QualificationData = {};

  const currentName = lead.name?.trim() ?? "";
  const nameIsPlaceholder =
    !currentName ||
    /^\+?\d[\d\s\-]{5,}$/.test(currentName) ||
    /^sms-/i.test(currentName) ||
    /^(unknown|lead|user|customer|new)$/i.test(currentName);

  if (parsed.name && nameIsPlaceholder && !parseCtx.awaitingChildDetails) {
    patch.name = parsed.name;
  }

  if (isUnknownInterest(lead.interest)) {
    if (parsed.interest) {
      patch.interest = parsed.interest;
    } else if (history.length > 0) {
      const fromHistory = inferProgrammeFromHistory(history, aliases);
      if (fromHistory) patch.interest = fromHistory;
    }
  }

  if (parsed.childAge != null || (parsed.isChild && (parsed.childName || parsed.childAge))) {
    patch.isChild = true;
    patch.childName = parsed.childName;
    patch.childAge = parsed.childAge;
  }

  const hasUpdates =
    !!patch.name || !!patch.interest || patch.childAge != null || !!patch.isChild;

  if (hasUpdates) {
    await applyQualificationUpdate(env, lead.id, patch);
  }

  return hasUpdates;
}

export async function ensureLeadProgramme(
  env: Env,
  leadId: string,
  lead: Pick<Lead, "interest">,
  opts?: {
    schedule?: import("../db/location-schedules").ProgrammeSchedule | null;
    history?: { role: string; text: string }[];
  }
): Promise<string | undefined> {
  const aliases = await getProgrammeAliases(env);
  const label = resolveProgrammeLabel(lead, { ...opts, aliases });
  if (label && isUnknownInterest(lead.interest)) {
    await applyQualificationUpdate(env, leadId, { interest: label });
  }
  return label ?? (isUnknownInterest(lead.interest) ? undefined : lead.interest);
}

export async function handleQualificationTurn(
  env: Env,
  lead: Lead,
  inboundText: string,
  history: { role: "lead" | "ai" | "staff"; text: string }[]
): Promise<AiReply | null> {
  const config = await getQualificationConfig(env);
  if (!config.enabled) return null;
  const requiredFields = getEffectiveRequiredFields(env, config.requiredFields);
  if (!needsQualification(lead, requiredFields)) return null;

  const aliases = await getProgrammeAliases(env);
  const aiCount = priorAiCount(history);
  const existing = savedName(lead);

  if (looksLikeQuestion(inboundText)) {
    return null;
  }

  const parseCtx = buildParseContext(lead, history, requiredFields);
  const parsed = parseQualificationReply(inboundText, aliases, parseCtx);
  const parsedLocationId = await resolveLocationIdFromText(env, inboundText);

  const locationChanged =
    parsedLocationId && parsedLocationId !== lead.locationId;

  const qualPatch: QualificationData = {};
  if (parsed.name && !parseCtx.parentNameEstablished) qualPatch.name = parsed.name;
  if (parsed.interest) qualPatch.interest = parsed.interest;
  if (locationChanged) qualPatch.locationId = parsedLocationId;
  if (parsed.childAge != null || parsed.isChild) {
    qualPatch.isChild = true;
    qualPatch.childName = parsed.childName;
    qualPatch.childAge = parsed.childAge;
  }

  if (Object.keys(qualPatch).length > 0) {
    await applyQualificationUpdate(env, lead.id, qualPatch);
  }

  const name = existing ?? parsed.name;
  const interest =
    parsed.interest ?? (lead.interest !== "Unknown" ? lead.interest : undefined);
  const locationId = parsedLocationId ?? lead.locationId;
  const locationName = locationId
    ? await getLocationNameById(env, locationId)
    : lead.location;

  const locationConfirmed =
    !requiredFields.includes("location") ||
    lead.locationConfirmed !== false ||
    !!parsedLocationId;

  const childSatisfied = childDetailsSatisfied(
    lead,
    parsed,
    requiredFields.includes("child")
  );

  // Re-read child age after update for gotEnough when we just parsed age
  const childSatisfiedNow =
    childSatisfied ||
    (parsed.childAge != null && requiredFields.includes("child"));

  const gotEnough = !requiredFields.some((f) => {
    if (f === "name") return !name;
    if (f === "interest") return !interest;
    if (f === "location") return !locationConfirmed;
    if (f === "child") return !childSatisfiedNow;
    return false;
  });

  if (aiCount >= 2 && !gotEnough) return null;

  const text = await buildQualificationReply(
    env,
    parsed,
    existing,
    inboundText,
    lead,
    locationName,
    interest,
    locationConfirmed,
    requiredFields,
    childSatisfiedNow
  );

  const inferredFromReply = extractProgrammeFromText(text, aliases);
  if (inferredFromReply && isUnknownInterest(lead.interest)) {
    await applyQualificationUpdate(env, lead.id, { interest: inferredFromReply });
  }

  const missingParts = requiredFields
    .filter((f) => {
      if (f === "name") return !name;
      if (f === "interest") return !interest;
      if (f === "location") return !locationConfirmed;
      if (f === "child") return !childSatisfiedNow;
      return false;
    })
    .join(", ");

  const stage = gotEnough ? "Qualifying" : "Discovery";
  const assessment = gotEnough
    ? `Qualified — ${interest ?? "enquiry"}`
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
