import { apiFetch } from "./client";

export async function restoreDemoSeed(): Promise<{
  seeded: boolean;
  count: number;
}> {
  return apiFetch("/admin/seed", { method: "POST" });
}
