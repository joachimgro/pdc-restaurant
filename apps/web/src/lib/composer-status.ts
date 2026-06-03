import type { Lead } from "@lead-intake/shared-types";

export function getComposerStatus(lead: Lead | null): string {
  if (!lead) return "";
  if (lead.aiPaused) return "Staff handling — AI paused";
  if (lead.status === "booked") return "Booked — AI monitoring for changes";
  if (lead.status === "cold") return "Lead cold — AI paused";
  if (lead.status === "waiting") return "Waiting on lead response";
  return "AI handling this conversation";
}
