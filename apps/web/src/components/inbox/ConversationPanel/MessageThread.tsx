"use client";

import { useEffect, useRef, useState } from "react";
import type { Lead } from "@lead-intake/shared-types";
import { useInboxStore } from "@/store/inbox-store";
import { IconChevron } from "../icons";

export function MessageThread({ lead }: { lead: Lead }) {
  const typingLeadId = useInboxStore((s) => s.typingLeadId);
  const showTyping = typingLeadId === lead.id;
  const bottomRef = useRef<HTMLDivElement>(null);
  const [openReasoning, setOpenReasoning] = useState<Set<number>>(new Set());

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [lead.messages, showTyping]);

  let lastFrom: string | null = null;
  let reasoningIndex = 0;

  return (
    <div className="messages">
      {lead.messages.map((m, i) => {
        if (m.kind === "day") {
          lastFrom = null;
          return (
            <div key={`day-${i}`} className="day-label">
              {m.day}
            </div>
          );
        }

        if (m.kind === "auto_followup") {
          lastFrom = null;
          return (
            <div key={`af-${i}`} className="auto-followup-divider">
              {m.label}
            </div>
          );
        }

        const isLead = m.from === "lead";
        const isStaff = m.from === "staff";
        const newSpeaker = lastFrom !== m.from;
        const tagText = isLead
          ? ""
          : isStaff
            ? m.staffAuthorName ?? "Staff"
            : "AI";
        const bubbleClass = isLead
          ? "message-lead"
          : isStaff
            ? "message-staff"
            : "message-ai";
        const hasReasoning = !!m.reasoning && !isLead;
        const rIdx = hasReasoning ? reasoningIndex++ : -1;
        const isOpen = rIdx >= 0 && openReasoning.has(rIdx);

        lastFrom = m.from;

        return (
          <div
            key={m.id ?? `msg-${i}`}
            className={`msg-block ${isLead ? "msg-block-lead" : "msg-block-system"} ${newSpeaker ? "new-speaker" : ""}`}
          >
            <div
              className={`msg-row ${isLead ? "from-lead" : "from-system"}`}
            >
              <div>
                <div className={`msg-bubble ${bubbleClass}`}>{m.text}</div>
                <div className="msg-meta">
                  {!isLead && <span className="msg-tag">{tagText}</span>}
                  <span>{m.time}</span>
                  {hasReasoning && (
                    <button
                      type="button"
                      className="reasoning-toggle"
                      onClick={() =>
                        setOpenReasoning((prev) => {
                          const next = new Set(prev);
                          if (next.has(rIdx)) next.delete(rIdx);
                          else next.add(rIdx);
                          return next;
                        })
                      }
                    >
                      why
                      <IconChevron />
                    </button>
                  )}
                </div>
              </div>
            </div>
            {hasReasoning && m.reasoning && (
              <div className={`reasoning ${isOpen ? "open" : ""}`}>
                <div className="reasoning-row">
                  <div className="reasoning-label">Verdict</div>
                  <div>
                    <span className="reasoning-verdict">
                      {m.reasoning.verdict}
                    </span>
                  </div>
                </div>
                <div className="reasoning-row">
                  <div className="reasoning-label">Stage</div>
                  <div>{m.reasoning.stage}</div>
                </div>
                <div className="reasoning-row">
                  <div className="reasoning-label">Note</div>
                  <div>{m.reasoning.note}</div>
                </div>
              </div>
            )}
          </div>
        );
      })}
      {showTyping && (
        <div className="msg-block msg-block-system new-speaker">
          <div className="msg-row from-system">
            <div className="typing">
              <div className="typing-dot" />
              <div className="typing-dot" />
              <div className="typing-dot" />
            </div>
          </div>
        </div>
      )}
      <div ref={bottomRef} />
    </div>
  );
}
