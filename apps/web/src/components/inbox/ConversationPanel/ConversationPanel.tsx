"use client";

import { useSelectedLead, useInboxStore } from "@/store/inbox-store";
import { getComposerStatus } from "@/lib/composer-status";
import { MessageThread } from "./MessageThread";

export function ConversationPanel() {
  const lead = useSelectedLead();
  const takeover = useInboxStore((s) => s.takeover);

  if (!lead) {
    return (
      <main className="conversation">
        <div className="conv-empty">Select a lead</div>
      </main>
    );
  }

  return (
    <main className="conversation">
      <div className="conv-header">
        <div className="conv-header-info">
          <div className="conv-name">{lead.name}</div>
          <div className="conv-sub">
            <span>{lead.phone}</span>
            <span className="conv-sub-dot" />
            <span>{lead.location}</span>
          </div>
        </div>
        <div className="conv-header-actions">
          <button type="button" className="ghost-btn">
            View profile
          </button>
        </div>
      </div>

      <MessageThread lead={lead} />

      <div className="composer">
        <div className="composer-row">
          <div className="composer-status">
            <div className="composer-status-dot" />
            <span>{getComposerStatus(lead)}</span>
          </div>
          <button
            type="button"
            className="takeover-btn"
            onClick={() => void takeover()}
          >
            Take over
          </button>
        </div>
      </div>
    </main>
  );
}
