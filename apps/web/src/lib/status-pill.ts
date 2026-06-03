import type { LeadStatus } from "@lead-intake/shared-types";

export function statusPillColor(
  status: LeadStatus
): "green" | "amber" | "red" | "blue" {
  if (status === "booked" || status === "qualified") return "green";
  if (status === "engaged" || status === "waiting") return "amber";
  if (status === "cold") return "red";
  return "blue";
}
