import type { Lead } from "@lead-intake/shared-types";
import type { ProgrammeSchedule } from "../db/location-schedules";

type HistoryLine = { role: string; text: string };

/** Scan text for an explicit programme name (longest alias first). */
export function extractProgrammeFromText(
  text: string,
  aliases: Record<string, string> = {}
): string | undefined {
  const lower = text.toLowerCase();
  const keys = Object.keys(aliases).sort((a, b) => b.length - a.length);
  for (const key of keys) {
    if (lower.includes(key)) return aliases[key];
  }
  return undefined;
}

/** Prefer the most recent AI recommendation in the thread. */
export function inferProgrammeFromHistory(
  history: HistoryLine[],
  aliases: Record<string, string> = {}
): string | undefined {
  for (const msg of [...history].reverse()) {
    if (msg.role !== "ai") continue;
    const found = extractProgrammeFromText(msg.text, aliases);
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
    aliases?: Record<string, string>;
  }
): string | undefined {
  if (!isUnknownInterest(lead.interest)) return lead.interest;

  const aliases = opts?.aliases ?? {};
  const fromHistory = opts?.history
    ? inferProgrammeFromHistory(opts.history, aliases)
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
