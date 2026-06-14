import type { Lead } from "@lead-intake/shared-types";

// Client locations are managed via the Admin panel and stored in D1.
// Do not add locations here — they will cause merge conflicts on base updates.
export const LOCATIONS: readonly {
  id: string;
  name: string;
  abbrev: string;
  badge: number | null;
}[] = [];

/**
 * LEAD_GROUPS — controls display ordering of seeded demo leads in the inbox.
 * Keys: "today" | "yesterday" | "thisWeek". Values: lead ids in rawLeads.
 *
 * Leave empty for production. Populate alongside rawLeads only for demo/dev
 * instances (ENABLE_DEMO_TOOLS=true).
 */
export const LEAD_GROUPS: {
  today: readonly string[];
  yesterday: readonly string[];
  thisWeek: readonly string[];
} = {
  today: [],
  yesterday: [],
  thisWeek: [],
};

/**
 * Build seeded demo leads. Empty by default — only used when
 * ENABLE_DEMO_TOOLS=true and /admin/seed is called.
 */
export function buildSeedLeads(): Record<string, Lead> {
  return {};
}

/**
 * OLIVIA_SIMULATE — payload for the "simulate a new lead" demo tool
 * (POST /leads/simulate, gated by ENABLE_DEMO_TOOLS).
 */
export const OLIVIA_SIMULATE = {
  name: "Demo Lead",
  phone: "+44 7700 900 000",
  location: "Main",
  locationId: "main",
  source: "Website",
  interest: "General enquiry",
  inboundText: "Hi, I'd like to find out more about getting started.",
  aiReply:
    "Hi! Thanks for reaching out — happy to help you get started. What are you most interested in?",
  reasoning: {
    verdict: "Approved",
    stage: "Discovery",
    note: "Acknowledged the enquiry and asked a qualifying question to advance the conversation.",
  },
};
