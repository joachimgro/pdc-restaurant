"use client";

import { useState } from "react";
import type { StaffUser } from "@lead-intake/shared-types";
import { useInboxStore } from "@/store/inbox-store";
import { TeamSection } from "./TeamSection";

export function AdminPanel({
  open,
  onClose,
  staffUser,
}: {
  open: boolean;
  onClose: () => void;
  staffUser: StaffUser | null;
}) {
  const restoreDemo = useInboxStore((s) => s.restoreDemoSeed);
  const [busy, setBusy] = useState<"seed" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const handleRestore = async () => {
    setBusy("seed");
    setError(null);
    setMessage(null);
    try {
      const result = await restoreDemo();
      setMessage(
        result.seeded
          ? `Restored ${result.count} demo leads.`
          : `Demo data already present (${result.count} leads).`
      );
      setTimeout(onClose, 1200);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Restore failed");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="admin-overlay" role="dialog" aria-modal="true">
      <button
        type="button"
        className="admin-backdrop"
        aria-label="Close"
        onClick={onClose}
      />
      <div className="admin-panel">
        <div className="admin-panel-header">
          <h2>Override</h2>
          <button type="button" className="admin-close" onClick={onClose}>
            ×
          </button>
        </div>

        <p className="admin-intro">
          Demo controls for the team inbox. These actions affect the live D1
          database.
        </p>

        {staffUser?.canManageTeam && <TeamSection staffUser={staffUser} />}

        <section className="admin-section">
          <h3>Restore demo data</h3>
          <p>
            Re-load the 7 sample leads (Sarah, Mark, Priya, etc.) if the inbox is
            empty.
          </p>
          <button
            type="button"
            className="admin-btn admin-btn-secondary"
            disabled={busy !== null}
            onClick={() => void handleRestore()}
          >
            {busy === "seed" ? "Restoring…" : "Restore demo leads"}
          </button>
        </section>

        {message && <p className="admin-success">{message}</p>}
        {error && <p className="admin-error">{error}</p>}
      </div>
    </div>
  );
}
