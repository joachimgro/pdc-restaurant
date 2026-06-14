"use client";

import type { Lead } from "@lead-intake/shared-types";
import {
  DISPLAY_STATUS_CONFIG,
  getLeadDisplayStatus,
} from "@/lib/lead-filters";
import { Avatar } from "../Avatar";

export function LeadRow({
  lead,
  active,
  listGroup,
  onSelect,
}: {
  lead: Lead;
  active: boolean;
  listGroup: "today" | "yesterday" | "thisWeek";
  onSelect: () => void;
}) {
  const displayStatus = getLeadDisplayStatus(lead, listGroup);
  const config = DISPLAY_STATUS_CONFIG[displayStatus];

  return (
    <div
      role="button"
      tabIndex={0}
      className={`lead-row ${active ? "active" : ""} ${lead.unread ? "unread" : ""} ${lead.justArrived ? "just-arrived" : ""}`}
      onClick={onSelect}
      onKeyDown={(e) => e.key === "Enter" && onSelect()}
    >
      <div className="lead-avatar">
        <Avatar name={lead.name} size={46} />
        {lead.unread && <span className="lead-unread-dot" />}
      </div>
      <div className="lead-row-main">
        <div className="lead-row-top">
          <div className="lead-name">{lead.name}</div>
          <div className="lead-time">{lead.time}</div>
        </div>
        <div className="lead-row-bottom">
          <div className="lead-preview">{lead.preview}</div>
          <span className={`lead-status ${config.labelClass}`}>
            {config.label}
          </span>
        </div>
      </div>
    </div>
  );
}
