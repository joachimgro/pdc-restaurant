import type { Lead } from "@lead-intake/shared-types";
import { toMessages, toTimeline } from "./parse";

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
 * LEAD_GROUPS — controls display ordering in the inbox UI.
 * Keys: "today" | "yesterday" | "thisWeek"
 * Values: arrays of lead ids matching keys in rawLeads below.
 *
 * Leave empty when ENABLE_DEMO_TOOLS is false (no seeded leads needed).
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
 * Raw demo leads — only used when ENABLE_DEMO_TOOLS=true and /admin/seed is called.
 * Add demo leads here for sales demos or local development.
 *
 * Each lead must have a matching entry in LEAD_GROUPS above.
 */
const rawLeads: Record<string, Omit<Lead, "messages" | "timeline"> & {
  rawMessages: Parameters<typeof toMessages>[0];
  rawTimeline: Parameters<typeof toTimeline>[0];
}> = {
  // TODO (optional): add demo leads here for sales demos.
  // Example:
  //
  // demo_lead_1: {
  //   id: "demo_lead_1",
  //   name: "Alex Smith",
  //   phone: "+44 7700 900 001",
  //   time: "5m",
  //   location: "Main Gym",
  //   locationId: "main",
  //   status: "new" as const,
  //   statusLabel: "New",
  //   assessment: "First enquiry",
  //   preview: "Hi, I'd like to know more about classes",
  //   unread: true,
  //   source: "Website",
  //   interest: "Adults BJJ",
  //   child: null,
  //   rawMessages: [
  //     { from: "lead", text: "Hi, I'd like to know more about classes", time: "5m" },
  //   ],
  //   rawTimeline: [
  //     { time: "5m", parts: [{ text: "Lead created via website intake" }] },
  //   ],
  // },
};

export function buildSeedLeads(): Record<string, Lead> {
  const result: Record<string, Lead> = {};
  for (const [id, raw] of Object.entries(rawLeads)) {
    const { rawMessages, rawTimeline, ...rest } = raw;
    result[id] = {
      ...rest,
      messages: toMessages(rawMessages),
      timeline: toTimeline(rawTimeline),
    };
  }
  return result;
}
