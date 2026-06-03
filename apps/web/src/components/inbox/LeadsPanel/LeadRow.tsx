"use client";

import type { Lead } from "@lead-intake/shared-types";

export function LeadRow({
  lead,
  active,
  onSelect,
}: {
  lead: Lead;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      className={`lead-row ${active ? "active" : ""} ${lead.unread ? "unread" : ""} ${lead.justArrived ? "just-arrived" : ""}`}
      onClick={onSelect}
      onKeyDown={(e) => e.key === "Enter" && onSelect()}
    >
      <div className={`lead-status-dot ${lead.status}`} />
      <div className="lead-body">
        <div className="lead-name">{lead.name}</div>
        <div className="lead-preview">{lead.preview}</div>
      </div>
      <div className="lead-meta">
        <div className="lead-time">{lead.time}</div>
        <div className="lead-location">{lead.location.substring(0, 3)}</div>
      </div>
    </div>
  );
}
