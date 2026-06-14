"use client";

import { useEffect, useState } from "react";
import type { StaffTeamMember, StaffUser } from "@lead-intake/shared-types";
import { fetchTeamMembers, inviteTeamMember } from "@/lib/api/client";

export function TeamSection({ staffUser }: { staffUser: StaffUser }) {
  const [members, setMembers] = useState<StaffTeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"admin" | "member">("member");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const list = await fetchTeamMembers();
        if (!cancelled) setMembers(list);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Could not load team");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const member = await inviteTeamMember(trimmed, role);
      setMembers((prev) => [...prev, member]);
      setEmail("");
      setMessage(`Invitation sent to ${trimmed}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invite failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="admin-section">
      <h3>Team access</h3>
      <p>
        Invite colleagues who can sign in, reply to leads, and leave notes. Each
        person picks a nickname on first login.
      </p>

      {loading ? (
        <p className="admin-intro">Loading team…</p>
      ) : (
        <ul className="team-list">
          {members.map((m) => (
            <li key={m.id} className="team-list-item">
              <div>
                <strong>{m.name}</strong>
                <span className="team-list-email">{m.email}</span>
              </div>
              <span className="team-list-meta">
                {m.role === "admin" ? "Admin" : "Member"}
                {m.status === "invited" ? " · invited" : ""}
              </span>
            </li>
          ))}
        </ul>
      )}

      <form className="team-invite-form" onSubmit={(e) => void handleInvite(e)}>
        <label className="admin-label" htmlFor="invite-email">
          Invite by email
        </label>
        <div className="team-invite-row">
          <input
            id="invite-email"
            type="email"
            className="admin-input"
            placeholder="colleague@academy.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={busy}
            required
          />
          {staffUser.canAssignAdmins && (
            <select
              className="admin-input admin-select"
              value={role}
              onChange={(e) =>
                setRole(e.target.value === "admin" ? "admin" : "member")
              }
              disabled={busy}
              aria-label="Role"
            >
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            </select>
          )}
          <button
            type="submit"
            className="admin-btn admin-btn-secondary"
            disabled={busy || !email.trim()}
          >
            {busy ? "Inviting…" : "Invite"}
          </button>
        </div>
      </form>

      {message && <p className="admin-success">{message}</p>}
      {error && <p className="admin-error">{error}</p>}
    </section>
  );
}
