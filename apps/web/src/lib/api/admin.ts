import { API_URL } from "./client";

export async function restoreDemoSeed(): Promise<{
  seeded: boolean;
  count: number;
}> {
  const res = await fetch(`${API_URL}/admin/seed`, { method: "POST" });
  const json = await res.json();
  if (!res.ok) {
    throw new Error((json as { error?: string }).error ?? "Seed failed");
  }
  return json as { seeded: boolean; count: number };
}
