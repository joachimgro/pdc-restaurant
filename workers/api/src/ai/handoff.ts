import type { Env } from "../env";
import { insertLeadNote } from "../db/lead-notes";
import { updateLeadFields } from "../db/leads";
import { simpleSchedulingEnabled } from "../capabilities";

const PREF_PATTERNS = [
  /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun)\b/i,
  /\b(morning|afternoon|evening|after\s+school|weekends?|weekdays?)\b/i,
  /\b\d{1,2}\s*(?:am|pm)\b/i,
  /\b\d{1,2}:\d{2}\b/,
  /\bworks?\s+for\s+me\b/i,
  /\b(anytime|flexible)\b/i,
];

export function detectSchedulingPreference(text: string): string | null {
  const t = text.trim();
  if (!t || t.length < 3) return null;
  const hasSignal = PREF_PATTERNS.some((p) => p.test(t));
  if (!hasSignal) return null;
  if (t.length > 200) return t.slice(0, 197) + "…";
  return t;
}

export async function captureHandoffSignals(
  env: Env,
  leadId: string,
  inboundText: string,
  existingNotes: { body: string }[] = []
): Promise<boolean> {
  if (simpleSchedulingEnabled(env)) return false;

  const preference = detectSchedulingPreference(inboundText);
  if (!preference) return false;

  const noteBody = `Preferred times: ${preference}`;
  const duplicate = existingNotes.some(
    (n) => n.body.trim().toLowerCase() === noteBody.toLowerCase()
  );
  if (duplicate) return false;

  await insertLeadNote(env.DB, leadId, noteBody, "AI");
  await updateLeadFields(env, leadId, {
    assessment: "Handoff — awaiting staff",
  });
  return true;
}
