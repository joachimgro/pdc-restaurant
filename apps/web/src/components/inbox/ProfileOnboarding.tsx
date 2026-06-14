"use client";

import { useState } from "react";
import type { StaffUser } from "@lead-intake/shared-types";
import { updateStaffProfile } from "@/lib/api/client";

export function ProfileOnboarding({
  user,
  onComplete,
}: {
  user: StaffUser;
  onComplete: (user: StaffUser) => void;
}) {
  const [nickname, setNickname] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = nickname.trim();
    if (!trimmed) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await updateStaffProfile(trimmed);
      onComplete(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save nickname");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="admin-overlay" role="dialog" aria-modal="true">
      <div className="admin-backdrop" aria-hidden />
      <div className="admin-panel onboarding-panel">
        <div className="admin-panel-header">
          <h2>Welcome</h2>
        </div>
        <p className="admin-intro">
          Choose a nickname your team will see on notes, messages, and activity
          for <strong>{user.email}</strong>.
        </p>
        <form className="login-form" onSubmit={(e) => void handleSubmit(e)}>
          <label className="admin-label" htmlFor="nickname">
            Nickname
          </label>
          <input
            id="nickname"
            className="admin-input"
            placeholder="e.g. Jo"
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            maxLength={40}
            autoFocus
            disabled={busy}
            required
          />
          <button
            type="submit"
            className="admin-btn admin-btn-secondary"
            disabled={busy || !nickname.trim()}
          >
            {busy ? "Saving…" : "Continue to inbox"}
          </button>
        </form>
        {error && <p className="admin-error">{error}</p>}
      </div>
    </div>
  );
}
