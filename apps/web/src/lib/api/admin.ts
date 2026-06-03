import { API_URL } from "./client";
import { getSession, clearSession } from "@/lib/auth";

const RESET_CONFIRM = "DELETE ALL LEADS";

function authHeaders(): Record<string, string> {
  const session = getSession();
  return session ? { Authorization: `Bearer ${session.token}` } : {};
}

function handleUnauthorized(): void {
  clearSession();
  if (typeof window !== "undefined") window.location.href = "/login";
}

export async function resetAllLeads(): Promise<{
  ok: boolean;
  leadsDeleted: number;
  message: string;
}> {
  const res = await fetch(`${API_URL}/admin/reset-all`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ confirm: RESET_CONFIRM }),
  });
  if (res.status === 401) { handleUnauthorized(); throw new Error("Unauthorized"); }
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
  const res = await fetch(`${API_URL}/admin/seed`, {
    method: "POST",
    headers: { ...authHeaders() },
  });
  if (res.status === 401) { handleUnauthorized(); throw new Error("Unauthorized"); }
  const json = await res.json();
  if (!res.ok) {
    throw new Error((json as { error?: string }).error ?? "Seed failed");
  }
  return json as { seeded: boolean; count: number };
}

export async function listAdmins(): Promise<
  { email: string; added_by: string | null; created_at: string }[]
> {
  const res = await fetch(`${API_URL}/admin/admins`, {
    headers: { ...authHeaders() },
  });
  if (res.status === 401) { handleUnauthorized(); throw new Error("Unauthorized"); }
  if (!res.ok) throw new Error("Failed to load admins");
  const data = await res.json() as { admins: { email: string; added_by: string | null; created_at: string }[] };
  return data.admins;
}

export async function addAdmin(email: string): Promise<void> {
  const res = await fetch(`${API_URL}/admin/admins`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ email }),
  });
  if (res.status === 401) { handleUnauthorized(); throw new Error("Unauthorized"); }
  const json = await res.json();
  if (!res.ok) throw new Error((json as { error?: string }).error ?? "Failed to add admin");
}

export async function removeAdmin(email: string): Promise<void> {
  const res = await fetch(`${API_URL}/admin/admins/${encodeURIComponent(email)}`, {
    method: "DELETE",
    headers: { ...authHeaders() },
  });
  if (res.status === 401) { handleUnauthorized(); throw new Error("Unauthorized"); }
  const json = await res.json();
  if (!res.ok) throw new Error((json as { error?: string }).error ?? "Failed to remove admin");
}

export async function logout(): Promise<void> {
  const session = getSession();
  if (!session) return;
  await fetch(`${API_URL}/auth/logout`, {
    method: "POST",
    headers: { Authorization: `Bearer ${session.token}` },
  }).catch(() => null);
  clearSession();
}

export { RESET_CONFIRM };
