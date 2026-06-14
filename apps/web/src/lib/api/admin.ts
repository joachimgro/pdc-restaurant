import { API_URL } from "./client";

const RESET_CONFIRM = "DELETE ALL LEADS";

export async function resetAllLeads(): Promise<{
  ok: boolean;
  leadsDeleted: number;
  message: string;
}> {
  const res = await fetch(`${API_URL}/admin/reset-all`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ confirm: RESET_CONFIRM }),
  });
  const json = await res.json();
  if (!res.ok) {
    throw new Error((json as { error?: string }).error ?? "Reset failed");
  }
  return json as { ok: boolean; leadsDeleted: number; message: string };
}

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

export { RESET_CONFIRM };
