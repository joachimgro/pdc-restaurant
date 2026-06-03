import {
  DomainEventSchema,
  LeadSchema,
  ListLeadsResponseSchema,
} from "@lead-intake/shared-types";
import type { DomainEvent, Lead } from "@lead-intake/shared-types";
import { getSession, clearSession } from "@/lib/auth";

const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787";

/** Redirect to /login and clear the local session. */
function handleUnauthorized(): void {
  clearSession();
  if (typeof window !== "undefined") {
    window.location.href = "/login";
  }
}

async function apiFetch<T>(
  path: string,
  init?: RequestInit
): Promise<T> {
  const session = getSession();

  const res = await fetch(`${API_URL}${path}`, {
    cache: "no-store",
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(session ? { Authorization: `Bearer ${session.token}` } : {}),
      ...init?.headers,
    },
  });

  if (res.status === 401) {
    handleUnauthorized();
    throw new Error("Session expired. Redirecting to login…");
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(
      (err as { error?: string }).error ?? `API error ${res.status}`
    );
  }

  return res.json() as Promise<T>;
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
  const session = getSession();

  const res = await fetch(`${API_URL}/leads/${encodeURIComponent(id)}`, {
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      ...(session ? { Authorization: `Bearer ${session.token}` } : {}),
    },
  });

  if (res.status === 401) {
    handleUnauthorized();
    return null;
  }
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
  const session = getSession();

  const res = await fetch(
    `${API_URL}/leads/${encodeURIComponent(id)}/select`,
    {
      method: "POST",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        ...(session ? { Authorization: `Bearer ${session.token}` } : {}),
      },
    }
  );

  if (res.status === 401) {
    handleUnauthorized();
    return null;
  }
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

export async function seedApi(): Promise<{ seeded: boolean; count: number }> {
  return apiFetch("/admin/seed", { method: "POST" });
}

export async function deleteLead(id: string): Promise<void> {
  await apiFetch(`/leads/${encodeURIComponent(id)}`, { method: "DELETE" });
}

/**
 * Subscribe to the SSE event stream.
 * The session token is passed as a query param because EventSource
 * does not support custom headers.
 */
export function subscribeEvents(
  onEvent: (event: DomainEvent) => void,
  cursor: string | null = null
): () => void {
  const session = getSession();
  const url = new URL(`${API_URL}/events/stream`);
  if (cursor) url.searchParams.set("cursor", cursor);
  if (session) url.searchParams.set("token", session.token);

  const es = new EventSource(url.toString());

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

export { API_URL };
