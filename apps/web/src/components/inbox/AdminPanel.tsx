"use client";

import { useState } from "react";
import type { StaffUser } from "@lead-intake/shared-types";
import { RESET_CONFIRM } from "@/lib/api/admin";
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
  const deleteAll = useInboxStore((s) => s.deleteAllLeads);
  const restoreDemo = useInboxStore((s) => s.restoreDemoSeed);
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState<"delete" | "seed" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const canDelete = confirmText === RESET_CONFIRM;

  const handleDelete = async () => {
    if (!canDelete) return;
    setBusy("delete");
    setError(null);
    setMessage(null);
    try {
      const result = await deleteAll();
      setMessage(result.message);
      setConfirmText("");
      setTimeout(onClose, 1200);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setBusy(null);
    }
  };

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

        <section className="admin-section admin-danger">
          <h3>Delete all contacts</h3>
          <p>
            Wipes the entire inbox at once. To remove one person, select them
            and use <strong>Delete contact</strong> at the bottom of the profile
            panel.
          </p>
          <p>
            Bulk delete removes every lead, conversation, timeline, and related
            events. Cannot be undone.
          </p>
          <label className="admin-label" htmlFor="confirm-delete">
            Type <strong>{RESET_CONFIRM}</strong> to confirm
          </label>
          <input
            id="confirm-delete"
            className="admin-input"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder={RESET_CONFIRM}
            autoComplete="off"
          />
          <button
            type="button"
            className="admin-btn admin-btn-danger"
            disabled={!canDelete || busy !== null}
            onClick={() => void handleDelete()}
          >
            {busy === "delete" ? "Deleting…" : "Delete all contacts"}
          </button>
        </section>

        {message && <p className="admin-success">{message}</p>}
        {error && <p className="admin-error">{error}</p>}
      </div>
    </div>
  );
}
