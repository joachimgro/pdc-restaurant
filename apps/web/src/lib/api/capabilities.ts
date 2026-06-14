import { apiFetch } from "./client";

export type Capabilities = {
  simpleScheduling: boolean;
  multiLocation: boolean;
};

export async function fetchCapabilities(): Promise<Capabilities> {
  return apiFetch("/admin/capabilities");
}
