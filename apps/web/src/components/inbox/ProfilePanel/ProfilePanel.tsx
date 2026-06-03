"use client";

import { useState } from "react";
import { useInboxStore, useSelectedLead } from "@/store/inbox-store";
import { statusPillColor } from "@/lib/status-pill";
import { Pill } from "../ui/Pill";

function TimelineText({
  parts,
}: {
  parts: { bold?: string; text: string }[];
}) {
  return (
    <>
      {parts.map((p, i) => (
        <span key={i}>
          {p.bold ? <strong>{p.bold}</strong> : null}
          {p.text}
        </span>
      ))}
    </>
  );
}

export function ProfilePanel() {
  const lead = useSelectedLead();
  const deleteLead = useInboxStore((s) => s.deleteLead);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!lead) {
    return <aside className="profile" />;
  }

  const pillColor = statusPillColor(lead.status);

  const handleDelete = async () => {
    setDeleting(true);
    setError(null);
    try {
      await deleteLead(lead.id);
      setConfirming(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <aside className="profile">
      <div className="profile-scroll">
        <div className="profile-head">
          <div className="profile-name">{lead.name}</div>
          <div className="profile-phone">{lead.phone}</div>
          <Pill color={pillColor}>{lead.statusLabel}</Pill>
          <div className="assessment">{lead.assessment}</div>
        </div>

        <div className="profile-section">
          <div className="section-label">Prospect</div>
          <div className="pill-group">
            <Pill>{lead.source}</Pill>
            <Pill>{lead.location}</Pill>
            <Pill>{lead.interest}</Pill>
            {lead.trialProposed && !lead.trialSlotLabel && (
              <Pill color="amber">Proposed · {lead.trialProposed.label}</Pill>
            )}
            {lead.trialSlotLabel && (
              <Pill color="green">Booked · {lead.trialSlotLabel}</Pill>
            )}
          </div>
        </div>

        {lead.child && (
          <div className="profile-section">
            <div className="section-label">Child</div>
            <div className="child-block">
              <div className="child-name">{lead.child.name}</div>
              <div className="pill-group">
                <Pill>Age {lead.child.age}</Pill>
                <Pill>{lead.child.experience}</Pill>
              </div>
            </div>
          </div>
        )}

        <div className="profile-section">
          <div className="section-label">Notes</div>
          <textarea
            className="notes-textarea"
            placeholder="Add a note for the team…"
            defaultValue=""
          />
        </div>

        <div className="profile-section">
          <div className="section-label">Activity</div>
          {lead.timeline.map((t, i) => (
            <div key={i} className="timeline-item">
              <div className="timeline-time">{t.time}</div>
              <div className="timeline-text">
                <TimelineText parts={t.parts} />
              </div>
            </div>
          ))}
        </div>

        <div className="profile-section profile-delete-section">
          <div className="section-label">Remove contact</div>
          {!confirming ? (
            <button
              type="button"
              className="profile-delete-btn"
              onClick={() => setConfirming(true)}
            >
              Delete contact
            </button>
          ) : (
            <div className="profile-delete-confirm">
              <p>
                Delete <strong>{lead.name}</strong> and their full conversation?
                This cannot be undone.
              </p>
              <div className="profile-delete-actions">
                <button
                  type="button"
                  className="profile-delete-cancel"
                  disabled={deleting}
                  onClick={() => {
                    setConfirming(false);
                    setError(null);
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="profile-delete-confirm-btn"
                  disabled={deleting}
                  onClick={() => void handleDelete()}
                >
                  {deleting ? "Deleting…" : "Delete permanently"}
                </button>
              </div>
            </div>
          )}
          {error && <p className="profile-delete-error">{error}</p>}
        </div>
      </div>
    </aside>
  );
}
