"use client";

import { useState } from "react";
import type { LeadNote } from "@lead-intake/shared-types";
import { useInboxStore } from "@/store/inbox-store";

function formatNoteTime(iso: string): string {
  try {
    const d = new Date(iso);
    const now = new Date();
    const sameDay =
      d.getDate() === now.getDate() &&
      d.getMonth() === now.getMonth() &&
      d.getFullYear() === now.getFullYear();
    if (sameDay) {
      return d.toLocaleTimeString("en-GB", {
        hour: "2-digit",
        minute: "2-digit",
      });
    }
    return d.toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function NoteCard({ note }: { note: LeadNote }) {
  return (
    <div className="note-card">
      <div className="note-card-head">
        <span className="note-author">{note.authorName}</span>
        <span className="note-time">{formatNoteTime(note.createdAt)}</span>
      </div>
      <p className="note-body">{note.body}</p>
    </div>
  );
}

export function LeadNotes({ notes }: { notes: LeadNote[] }) {
  const addLeadNote = useInboxStore((s) => s.addLeadNote);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAdd() {
    const text = draft.trim();
    if (!text || saving) return;
    setSaving(true);
    setError(null);
    try {
      await addLeadNote(text);
      setDraft("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add note");
    } finally {
      setSaving(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void handleAdd();
    }
  }

  return (
    <div className="profile-section">
      <div className="section-label">Notes</div>

      {notes.length === 0 ? (
        <p className="notes-empty">No notes yet — add one for the team.</p>
      ) : (
        <div className="notes-list">
          {notes.map((note) => (
            <NoteCard key={note.id} note={note} />
          ))}
        </div>
      )}

      <div className="notes-compose">
        <textarea
          className="notes-textarea"
          placeholder="Leave a note for the team…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={3}
          disabled={saving}
        />
        {error && <p className="notes-error">{error}</p>}
        <button
          type="button"
          className="btn-primary notes-add-btn"
          onClick={() => void handleAdd()}
          disabled={!draft.trim() || saving}
        >
          {saving ? "Adding…" : "Add note"}
        </button>
      </div>
    </div>
  );
}
