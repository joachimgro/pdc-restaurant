"use client";

const SESSION_KEY = "pdc_session";

export interface Session {
  token: string;
  email: string;
}

/** Read the current session from localStorage. Returns null if not found or SSR. */
export function getSession(): Session | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "token" in parsed &&
      "email" in parsed &&
      typeof (parsed as Session).token === "string" &&
      typeof (parsed as Session).email === "string"
    ) {
      return parsed as Session;
    }
    return null;
  } catch {
    return null;
  }
}

/** Persist a session to localStorage. */
export function setSession(token: string, email: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify({ token, email }));
  } catch {
    // Private browsing or storage quota — fail silently
  }
}

/** Clear the session from localStorage (logout). */
export function clearSession(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {
    // ignore
  }
}
