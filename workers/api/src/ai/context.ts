import type { Lead, Message } from "@lead-intake/shared-types";
import { getLead } from "../db/leads";
import { getAiConfig, getLocationOverride } from "../db/ai-config";
import type { Env } from "../env";
import type { ProgrammeSchedule } from "../db/location-schedules";
import { buildLeadIntakeContextBlock } from "./intake-context";

export interface ConversationContext {
  lead: Lead;
  inboundText: string;
  history: { role: "lead" | "ai" | "staff"; text: string }[];
  locationOverride: string | null;
  aiConfig: Awaited<ReturnType<typeof getAiConfig>>;
  /** Form-derived facts — same branch/programme every turn */
  intakeContextBlock: string;
  scheduleLine: string;
  dbSchedule: ProgrammeSchedule | null;
}

const MAX_HISTORY = 12;

export interface StructuredTurn {
  role: "user" | "assistant";
  content: string;
}

export function buildStructuredHistory(
  history: { role: string; text: string }[]
): StructuredTurn[] {
  const turns: StructuredTurn[] = [];

  for (const h of history) {
    if (h.role === "lead") {
      turns.push({ role: "user", content: h.text });
    } else if (h.role === "ai" || h.role === "staff") {
      const last = turns[turns.length - 1];
      if (last && last.role === "assistant") {
        last.content += "\n" + h.text;
      } else {
        turns.push({ role: "assistant", content: h.text });
      }
    }
  }

  const merged: StructuredTurn[] = [];
  for (const turn of turns) {
    const last = merged[merged.length - 1];
    if (last && last.role === turn.role) {
      last.content += "\n" + turn.content;
    } else {
      merged.push({ ...turn });
    }
  }

  if (merged.length > 0 && merged[0].role === "assistant") {
    merged.unshift({
      role: "user",
      content: "(Lead initiated contact via website form)",
    });
  }

  return merged;
}

/** History for LLM — omit the latest lead line when it is the same as inbound (already in current-turn prompt). */
export function buildStructuredHistoryForLlm(
  history: { role: string; text: string }[],
  inboundText: string
): StructuredTurn[] {
  const trimmed = inboundText.trim();
  let slice = history;
  if (trimmed) {
    const last = history[history.length - 1];
    if (last?.role === "lead" && last.text.trim() === trimmed) {
      slice = history.slice(0, -1);
    }
  }
  return buildStructuredHistory(slice);
}

export async function buildConversationContext(
  env: Env,
  leadId: string,
  inboundText: string,
  scheduleLine = "",
  dbSchedule: ProgrammeSchedule | null = null
): Promise<ConversationContext | null> {
  const lead = await getLead(env, leadId);
  if (!lead) return null;

  const history = lead.messages
    .filter((m): m is Message & { kind: "chat" } => m.kind === "chat")
    .slice(-MAX_HISTORY)
    .map((m) => ({
      role: m.from as "lead" | "ai" | "staff",
      text: m.text,
    }));

  const [aiConfig, locationOverride] = await Promise.all([
    getAiConfig(env),
    getLocationOverride(env.DB, lead.locationId),
  ]);

  const schedule =
    scheduleLine || "through the week — confirm at booking";
  const intakeContextBlock = buildLeadIntakeContextBlock(
    lead,
    schedule,
    dbSchedule
  );

  return {
    lead,
    inboundText: inboundText || "(new enquiry — no message yet)",
    history,
    locationOverride,
    aiConfig,
    intakeContextBlock,
    scheduleLine: schedule,
    dbSchedule,
  };
}
