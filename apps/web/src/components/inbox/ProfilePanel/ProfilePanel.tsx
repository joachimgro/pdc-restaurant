"use client";

import { useState } from "react";
import { useInboxStore, useSelectedLead } from "@/store/inbox-store";
import { getProfileStatusLine } from "@/lib/lead-filters";
import { Avatar } from "../Avatar";
import { LeadNotes } from "./LeadNotes";

function formatConfirmedAt(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("en-GB", {
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export function ProfilePanel({ onClose }: { onClose: () => void }) {
  const lead = useSelectedLead();
  const deleteLead = useInboxStore((s) => s.deleteLead);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!lead) {
    return <aside className="profile" />;
  }

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

  const locationLabel =
    lead.locationConfirmed === false ? "Location TBC" : lead.location;
  const statusLine = getProfileStatusLine(lead);
  const isBooked = Boolean(lead.trialSlotLabel);

  return (
    <aside className="profile">
      <div className="profile-scroll">
        {/* Contact header */}
        <div className="profile-head">
          <button
            type="button"
            className="profile-close-btn"
            onClick={onClose}
            aria-label="Close profile"
          >
            ×
          </button>
          <div className="profile-head-center">
            <Avatar name={lead.name} size={68} />
            <div>
              <div className="profile-name">{lead.name}</div>
              <div className="profile-phone">{lead.phone}</div>
            </div>
          </div>
        </div>

        {/* Status block — red border normally, green when booked */}
        <div className={`status-block ${isBooked ? "booked" : ""}`}>
          <div className="status-label">Status</div>
          <div className="status-value">{statusLine}</div>
          {lead.trialConfirmedAt && (
            <div className="status-confirmed">
              Confirmed {formatConfirmedAt(lead.trialConfirmedAt)}
            </div>
          )}
        </div>

        {/* Prospect tags */}
        <div className="profile-section">
          <div className="section-label">Prospect</div>
          <div className="tag-group">
            <span className="tag">{lead.source}</span>
            <span className="tag">{locationLabel}</span>
            {lead.interest && lead.interest !== "Unknown" && (
              <span className="tag">{lead.interest}</span>
            )}
          </div>
        </div>

        {/* Child block */}
        {lead.child && (
          <div className="profile-section">
            <div className="section-label">Child</div>
            <div className="child-block">
              {lead.child.name && lead.child.name !== "—" && (
                <div className="child-name">{lead.child.name}</div>
              )}
              <div className="tag-group">
                {lead.child.age && lead.child.age !== "—" && (
                  <span className="tag">Age {lead.child.age}</span>
                )}
                {lead.interest && lead.interest !== "Unknown" && (
                  <span className="tag">{lead.interest}</span>
                )}
                {lead.child.experience && (
                  <span className="tag">{lead.child.experience}</span>
                )}
              </div>
            </div>
          </div>
        )}

        <LeadNotes notes={lead.notes} />

        {/* Activity log */}
        <div className="profile-section">
          <div className="section-label">Activity</div>
          {lead.timeline.length === 0 ? (
            <div className="timeline-empty">No activity yet</div>
          ) : (
            lead.timeline.map((t, i) => {
              const title = t.parts.find((p) => p.bold)?.bold ?? "";
              const detail = t.parts.map((p) => p.text).join("");
              return (
                <div key={i} className="activity-row">
                  <div className="activity-time">{t.time}</div>
                  <div className="activity-event">
                    {title ? (
                      <>
                        <strong>{title}</strong>
                        {detail ? <span>{detail}</span> : null}
                      </>
                    ) : (
                      <span>{detail}</span>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Delete contact */}
        <div className="profile-section profile-delete-section">
          <div className="section-label">Remove contact</div>
          {!confirming ? (
            <button
              type="button"
              className="btn-destructive"
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
                  className="btn-secondary"
                  disabled={deleting}
                  style={{ width: "100%" }}
                  onClick={() => {
                    setConfirming(false);
                    setError(null);
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn-destructive"
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
