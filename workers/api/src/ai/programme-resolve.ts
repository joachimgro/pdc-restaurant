import type { Lead } from "@lead-intake/shared-types";
import type { ProgrammeSchedule } from "../db/location-schedules";

const PROGRAMME_ALIASES: Record<string, string> = {
  bjj: "BJJ",
  "jiu jitsu": "BJJ",
  "jiu-jitsu": "BJJ",
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
};

/** Scan text for an explicit programme name (longest alias first). */
export function extractProgrammeFromText(text: string): string | undefined {
  const lower = text.toLowerCase();
  const aliases = Object.keys(PROGRAMME_ALIASES).sort(
    (a, b) => b.length - a.length
  );
  for (const key of aliases) {
    if (lower.includes(key)) return PROGRAMME_ALIASES[key];
  }
  return undefined;
}

type HistoryLine = { role: string; text: string };

/** Prefer the most recent AI recommendation in the thread. */
export function inferProgrammeFromHistory(
  history: HistoryLine[]
): string | undefined {
  for (const msg of [...history].reverse()) {
    if (msg.role !== "ai") continue;
    const found = extractProgrammeFromText(msg.text);
    if (found) return found;
  }
  return undefined;
}

export function isUnknownInterest(interest: string | undefined | null): boolean {
  return !interest || interest.trim() === "" || interest === "Unknown";
}

/** Best programme label for copy — never returns "Unknown". */
export function resolveProgrammeLabel(
  lead: Pick<Lead, "interest">,
  opts?: {
    schedule?: ProgrammeSchedule | null;
    history?: HistoryLine[];
  }
): string | undefined {
  if (!isUnknownInterest(lead.interest)) return lead.interest;

  const fromHistory = opts?.history
    ? inferProgrammeFromHistory(opts.history)
    : undefined;
  if (fromHistory) return fromHistory;

  const scheduleProgramme = opts?.schedule?.programme;
  if (scheduleProgramme && !isUnknownInterest(scheduleProgramme)) {
    return scheduleProgramme;
  }

  return undefined;
}

/** e.g. " for Muay Thai" or "" when programme unknown. */
export function programmeForPhrase(programme: string | undefined): string {
  return programme ? ` for ${programme}` : "";
}
