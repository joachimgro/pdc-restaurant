import type { Lead } from "@lead-intake/shared-types";

/**
 * LOCATIONS — used by seedDatabase() to populate the locations table.
 *
 * Replace with the client's actual locations.
 * Each entry needs: id (slug), name (display), abbrev (1–2 chars for badge), badge (unread count or null).
 *
 * Example:
 *   { id: "london-hq", name: "London HQ", abbrev: "L", badge: null }
 */
export const LOCATIONS: readonly {
  id: string;
  name: string;
  abbrev: string;
  badge: number | null;
}[] = [
  // TODO: replace with client locations
  // { id: "main", name: "Main Gym", abbrev: "M", badge: null },
];

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
 *
 * To add demo leads for a sales demo, return a Record<string, Lead> here
 * with ids matching LEAD_GROUPS above.
 */
export function buildSeedLeads(): Record<string, Lead> {
  return {};
}

/**
 * OLIVIA_SIMULATE — payload for the "simulate a new lead" demo tool
 * (POST /leads/simulate, gated by ENABLE_DEMO_TOOLS). Generic placeholder;
 * customise for live sales demos if desired.
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
