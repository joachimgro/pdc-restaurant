import type { Lead, Message } from "@lead-intake/shared-types";

export type LeadFilterTab = "all" | "new" | "booked" | "no_response";

export const LEAD_FILTER_TABS: { id: LeadFilterTab; label: string }[] = [
  { id: "all", label: "All" },
  { id: "new", label: "New" },
  { id: "booked", label: "Booked" },
  { id: "no_response", label: "No Response" },
];

const NO_RESPONSE_WINDOW_MS = 24 * 60 * 60 * 1000;

function chatMessages(lead: Lead): Extract<Message, { kind: "chat" }>[] {
  return lead.messages.filter((m): m is Extract<Message, { kind: "chat" }> => m.kind === "chat");
}

export function hasAiConversation(lead: Lead): boolean {
  return chatMessages(lead).some((m) => m.from === "ai");
}

function lastMessageIndices(lead: Lead): {
  lastAi: number;
  lastLead: number;
} {
  const chats = chatMessages(lead);
  let lastAi = -1;
  let lastLead = -1;
  chats.forEach((m, i) => {
    if (m.from === "ai") lastAi = i;
    if (m.from === "lead") lastLead = i;
  });
  return { lastAi, lastLead };
}

/** Lead has not replied since the last AI message. */
export function leadAwaitingReply(lead: Lead): boolean {
  const { lastAi, lastLead } = lastMessageIndices(lead);
  if (lastAi < 0) return false;
  return lastLead < lastAi;
}

/**
 * A lead is "no response" if the AI has sent at least one message
 * and the lead hasn't replied since. No time-bucket approximation needed —
 * the message order is the source of truth.
 */
export function isNoResponseLead(
  lead: Lead,
  _listGroup?: "today" | "yesterday" | "thisWeek"
): boolean {
  if (lead.aiPaused || lead.status === "booked") return false;
  if (!hasAiConversation(lead)) return false;
  return leadAwaitingReply(lead);
}

export function isNewLead(
  lead: Lead,
  listGroup: "today" | "yesterday" | "thisWeek"
): boolean {
  if (lead.status === "booked" || lead.trialConfirmedAt) return false;
  // Lead has never had an AI message yet — genuinely new
  if (!hasAiConversation(lead)) return true;
  // AI has replied; if lead hasn't responded that's "no response", not "new"
  if (leadAwaitingReply(lead)) return false;
  if (lead.status === "new") return true;
  if (
    listGroup === "today" &&
    lead.status !== "cold" &&
    lead.status !== "waiting"
  ) {
    return true;
  }
  return false;
}

export function matchesLeadFilter(
  lead: Lead,
  tab: LeadFilterTab,
  listGroup: "today" | "yesterday" | "thisWeek"
): boolean {
  switch (tab) {
    case "all":
      return true;
    case "booked":
      return lead.status === "booked";
    case "new":
      return isNewLead(lead, listGroup);
    case "no_response":
      return isNoResponseLead(lead, listGroup);
    default:
      return true;
  }
}

export type LeadDisplayStatus =
  | "new"
  | "active"
  | "qualified"
  | "booked"
  | "no_reply"
  | "manual";

export function getLeadDisplayStatus(
  lead: Lead,
  listGroup: "today" | "yesterday" | "thisWeek"
): LeadDisplayStatus {
  if (lead.aiPaused) return "manual";
  if (lead.status === "booked") return "booked";
  if (lead.status === "qualified") return "qualified";
  if (isNoResponseLead(lead, listGroup)) return "no_reply";
  if (isNewLead(lead, listGroup)) return "new";
  return "active";
}

export const DISPLAY_STATUS_CONFIG: Record<
  LeadDisplayStatus,
  { label: string; labelClass: string }
> = {
  new: { label: "Enquired", labelClass: "" },
  active: { label: "In conversation", labelClass: "" },
  qualified: { label: "Ready to book", labelClass: "" },
  booked: { label: "Trial booked", labelClass: "trial-booked" },
  no_reply: { label: "No reply", labelClass: "" },
  manual: { label: "Staff handling", labelClass: "staff-handling" },
};

export function getProfileStatusLine(
  lead: Lead,
  listGroup: "today" | "yesterday" | "thisWeek" = "today"
): string {
  if (lead.trialSlotLabel) return lead.trialSlotLabel;
  const display = getLeadDisplayStatus(lead, listGroup);
  return DISPLAY_STATUS_CONFIG[display].label;
}

export function filterCountLabel(tab: LeadFilterTab, count: number): string {
  switch (tab) {
    case "all":
      return `${count} active`;
    case "new":
      return `${count} new`;
    case "booked":
      return `${count} booked`;
    case "no_response":
      return `${count} no reply`;
    default:
      return `${count} active`;
  }
}

export function countLeadsMatchingFilter(
  leads: Record<string, Lead>,
  groups: { today: string[]; yesterday: string[]; thisWeek: string[] },
  tab: LeadFilterTab
): number {
  let n = 0;
  (["today", "yesterday", "thisWeek"] as const).forEach((groupKey) => {
    for (const id of groups[groupKey]) {
      const lead = leads[id];
      if (lead && matchesLeadFilter(lead, tab, groupKey)) n++;
    }
  });
  return n;
}

// Reserved for future API timestamps
export const NO_RESPONSE_WINDOW_HOURS = NO_RESPONSE_WINDOW_MS / (60 * 60 * 1000);
