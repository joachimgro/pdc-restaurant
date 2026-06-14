import type { Lead } from "@lead-intake/shared-types";

export function getComposerStatus(lead: Lead | null): string {
  if (!lead) return "";
  if (lead.aiPaused) return "STAFF HANDLING — AI PAUSED";
  if (lead.status === "booked") return "TRIAL BOOKED — AI MONITORING";
  if (lead.status === "cold") return "LEAD COLD — AI PAUSED";
  if (lead.status === "waiting") return "WAITING ON LEAD RESPONSE";
  return "AI IN CONVERSATION";
}
