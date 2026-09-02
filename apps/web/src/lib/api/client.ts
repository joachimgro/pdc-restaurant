import {
  DomainEventSchema,
  LeadSchema,
  ListLeadsResponseSchema,
  StaffTeamListSchema,
  StaffTeamMemberSchema,
  StaffUserSchema,
} from "@lead-intake/shared-types";
import type { DomainEvent, Lead, StaffTeamMember, StaffUser } from "@lead-intake/shared-types";

/** Build-time upstream Worker URL (also used as the same-origin proxy target). */
export const API_UPSTREAM =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787";

/**
 * Browser API base. On the live kitchen host, use `/api/pdc` so Safari/iPad
 * never does a cross-origin credentialed fetch (which surfaces as "Load failed").
 */
export function getApiUrl(): string {
  if (typeof window !== "undefined") {
    const host = window.location.hostname;
    if (
      host === "kitchen.phiof.digital" ||
      host === "pdc-restaurant-web.justphiof.workers.dev"
    ) {
      return `${window.location.origin}/api/pdc`;
    }
  }
  return API_UPSTREAM;
}

/** @deprecated Prefer getApiUrl() — kept for call-site compatibility. */
export const API_URL = API_UPSTREAM;

export async function apiFetch<T>(
  path: string,
  init?: RequestInit
): Promise<T> {
  const res = await fetch(`${getApiUrl()}${path}`, {
    cache: "no-store",
    credentials: "include",
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(
      (err as { error?: string }).error ?? `API error ${res.status}`
    );
  }
  return res.json() as Promise<T>;
}

export async function fetchAuthMe(): Promise<StaffUser | null> {
  try {
    const res = await fetch(`${getApiUrl()}/auth/me`, {
      cache: "no-store",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      // Safari/iPad can stall forever on a hung credentialed request.
      signal: AbortSignal.timeout(12_000),
    });
    if (res.status === 401) return null;
    if (!res.ok) return null;
    const data = (await res.json()) as { user: unknown };
    return StaffUserSchema.parse(data.user);
  } catch {
    // Network/CORS/parse failures must not leave the app stuck on "Loading…"
    return null;
  }
}

export async function requestMagicLink(
  email: string,
  next?: string
): Promise<{ devVerifyUrl?: string }> {
  return apiFetch("/auth/magic-link", {
    method: "POST",
    body: JSON.stringify({
      email,
      ...(next && next.startsWith("/") && !next.startsWith("//")
        ? { next }
        : {}),
    }),
  });
}

export async function logoutAuth(): Promise<void> {
  await apiFetch("/auth/logout", { method: "POST" });
}

export async function updateStaffProfile(displayName: string): Promise<StaffUser> {
  const data = await apiFetch<{ user: unknown }>("/auth/profile", {
    method: "PATCH",
    body: JSON.stringify({ displayName }),
  });
  return StaffUserSchema.parse(data.user);
}

export async function fetchTeamMembers(): Promise<StaffTeamMember[]> {
  const data = await apiFetch<{ members: unknown }>("/auth/team");
  return StaffTeamListSchema.parse(data).members;
}

export async function inviteTeamMember(
  email: string,
  role: "admin" | "member"
): Promise<StaffTeamMember> {
  const data = await apiFetch<{ member: unknown }>("/auth/team/invite", {
    method: "POST",
    body: JSON.stringify({ email, role }),
  });
  return StaffTeamMemberSchema.parse(data.member);
}

export async function fetchLeads() {
  const data = await apiFetch<unknown>("/leads");
  return ListLeadsResponseSchema.parse(data);
}

export async function fetchLead(id: string): Promise<Lead> {
  const data = await apiFetch<unknown>(`/leads/${encodeURIComponent(id)}`);
  return LeadSchema.parse(data);
}

/** Returns null when the lead no longer exists (e.g. after delete). */
export async function fetchLeadOrNull(id: string): Promise<Lead | null> {
  const res = await fetch(`${getApiUrl()}/leads/${encodeURIComponent(id)}`, {
    cache: "no-store",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(
      (err as { error?: string }).error ?? `API error ${res.status}`
    );
  }
  const data = (await res.json()) as unknown;
  return LeadSchema.parse(data);
}

export async function selectLead(id: string): Promise<Lead> {
  const lead = await selectLeadOrNull(id);
  if (!lead) throw new Error("Not found");
  return lead;
}

/** Mark read and return lead; null if deleted. */
export async function selectLeadOrNull(id: string): Promise<Lead | null> {
  const res = await fetch(
    `${getApiUrl()}/leads/${encodeURIComponent(id)}/select`,
    {
      method: "POST",
      cache: "no-store",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
    }
  );
  if (res.status === 404) return null;
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(
      (err as { error?: string }).error ?? `API error ${res.status}`
    );
  }
  const data = (await res.json()) as unknown;
  return LeadSchema.parse(data);
}

export async function simulateNewLead(): Promise<{
  lead: Lead;
  queued: boolean;
}> {
  return apiFetch("/leads/simulate", { method: "POST" });
}

export async function takeoverLead(id: string): Promise<Lead> {
  const data = await apiFetch<unknown>(`/leads/${id}/takeover`, {
    method: "POST",
  });
  return LeadSchema.parse(data);
}

export async function resumeAiLead(id: string): Promise<Lead> {
  const data = await apiFetch<unknown>(`/leads/${id}/resume-ai`, {
    method: "POST",
  });
  return LeadSchema.parse(data);
}

export async function seedApi(): Promise<{ seeded: boolean; count: number }> {
  return apiFetch("/admin/seed", { method: "POST" });
}

export async function deleteLead(id: string): Promise<void> {
  await apiFetch(`/leads/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function sendStaffMessage(
  id: string,
  text: string
): Promise<{ lead: Lead; smsSent: boolean }> {
  const data = await apiFetch<{ lead: unknown; smsSent: boolean }>(
    `/leads/${encodeURIComponent(id)}/messages`,
    {
      method: "POST",
      body: JSON.stringify({ text }),
    }
  );
  return { lead: LeadSchema.parse(data.lead), smsSent: data.smsSent };
}

export async function addLeadNote(id: string, body: string): Promise<Lead> {
  const data = await apiFetch<unknown>(
    `/leads/${encodeURIComponent(id)}/notes`,
    {
      method: "POST",
      body: JSON.stringify({ body }),
    }
  );
  return LeadSchema.parse(data);
}

export function subscribeEvents(
  onEvent: (event: DomainEvent) => void,
  cursor: string | null = null
): () => void {
  const url = new URL(`${getApiUrl()}/events/stream`);
  if (cursor) url.searchParams.set("cursor", cursor);

  const es = new EventSource(url.toString(), { withCredentials: true });

  es.onmessage = (msg) => {
    try {
      const parsed = JSON.parse(msg.data) as { event?: unknown };
      const event = DomainEventSchema.parse(parsed.event ?? parsed);
      onEvent(event);
      if (msg.lastEventId) {
        cursor = msg.lastEventId;
        try {
          sessionStorage.setItem("lead-intake-sse-cursor", msg.lastEventId);
        } catch {
          /* private mode */
        }
      }
    } catch (e) {
      console.warn("SSE parse error", e);
    }
  };

  es.onerror = () => {
    // EventSource reconnects automatically
  };

  return () => es.close();
}
