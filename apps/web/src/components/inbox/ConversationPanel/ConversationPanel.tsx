"use client";

import { useRef, useState } from "react";
import { useSelectedLead, useInboxStore } from "@/store/inbox-store";
import { Avatar } from "../Avatar";
import { MessageThread } from "./MessageThread";

function getAiStatusClass(aiPaused: boolean | undefined, status: string): string {
  if (aiPaused) return "paused";
  if (status === "booked") return "monitoring";
  return "active";
}

function getAiStatusLabel(aiPaused: boolean | undefined, status: string): string {
  if (aiPaused) return "Staff handling — AI paused";
  if (status === "booked") return "AI monitoring";
  return "AI in conversation";
}

function StaffComposer({ onHandBack }: { onHandBack: () => void }) {
  const sendStaffMessage = useInboxStore((s) => s.sendStaffMessage);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [smsBanner, setSmsBanner] = useState<"sent" | "saved" | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  async function handleSend() {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    setSending(true);
    setError(null);
    setSmsBanner(null);
    try {
      const { smsSent } = await sendStaffMessage(trimmed);
      setText("");
      setSmsBanner(smsSent ? "sent" : "saved");
      setTimeout(() => setSmsBanner(null), 3500);
      textareaRef.current?.focus();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not send message");
    } finally {
      setSending(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  }

  return (
    <div className="staff-composer">
      <div className="staff-composer-bar">
        <button
          type="button"
          className="btn-hand-back"
          onClick={onHandBack}
          title="Hand back to AI"
        >
          Hand back to AI
        </button>
        {smsBanner === "sent" && (
          <span className="composer-sms-badge composer-sms-badge--sent">
            SMS sent ✓
          </span>
        )}
        {smsBanner === "saved" && (
          <span className="composer-sms-badge composer-sms-badge--saved">
            Saved (SMS not configured)
          </span>
        )}
        {error && (
          <span className="composer-error">{error}</span>
        )}
      </div>
      <div className="staff-composer-input-row">
        <textarea
          ref={textareaRef}
          className="composer-textarea"
          placeholder="Type your message… (Enter to send, Shift+Enter for new line)"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={2}
          disabled={sending}
          autoFocus
        />
        <button
          type="button"
          className="composer-send-btn"
          onClick={() => void handleSend()}
          disabled={!text.trim() || sending}
          aria-label="Send message"
        >
          {sending ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.5, animation: "spin 1s linear infinite" }}>
              <path d="M21 12a9 9 0 1 1-6.219-8.56" />
            </svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          )}
        </button>
      </div>
    </div>
  );
}

export function ConversationPanel({
  profileOpen,
  onToggleProfile,
}: {
  profileOpen: boolean;
  onToggleProfile: () => void;
}) {
  const lead = useSelectedLead();
  const toggleAiControl = useInboxStore((s) => s.toggleAiControl);

  if (!lead) {
    return (
      <main className="conversation">
        <div className="conv-empty">Select a lead</div>
      </main>
    );
  }

  const aiStatusClass = getAiStatusClass(lead.aiPaused, lead.status);
  const aiStatusLabel = getAiStatusLabel(lead.aiPaused, lead.status);

  return (
    <main className="conversation">
      <div className="conv-header">
        <div className="conv-header-left">
          <Avatar name={lead.name} size={42} />
          <div className="conv-header-info">
            <div className="conv-name">{lead.name}</div>
            <div className="conv-sub">
              <span>{lead.phone}</span>
              <span className="conv-sub-dot" />
              <span>{lead.location}</span>
            </div>
          </div>
        </div>
        <div className="conv-header-actions">
          {!profileOpen && (
            <button
              type="button"
              className="btn-view-profile"
              onClick={onToggleProfile}
            >
              View profile
            </button>
          )}
        </div>
      </div>

      <MessageThread lead={lead} />

      {lead.aiPaused ? (
        <StaffComposer onHandBack={() => void toggleAiControl()} />
      ) : (
        <div className="bottom-bar">
          <span className={`ai-status ${aiStatusClass}`}>{aiStatusLabel}</span>
          <button
            type="button"
            className="btn-take-over"
            onClick={() => void toggleAiControl()}
          >
            Take over
          </button>
        </div>
      )}
    </main>
  );
}
