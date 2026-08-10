import { apiFetch } from "./client";

export type Capabilities = {
  simpleScheduling: boolean;
  multiLocation: boolean;
  service: boolean;
  reservations: boolean;
  waitlist: boolean;
  deposits: boolean;
  floorPlan: boolean;
  autoAssign: boolean;
  kitchen: boolean;
};

export async function fetchCapabilities(): Promise<Capabilities> {
  return apiFetch("/admin/capabilities");
}
