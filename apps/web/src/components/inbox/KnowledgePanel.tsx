"use client";

import { useCallback, useEffect, useState } from "react";
import {
  createKnowledgeChunk,
  deleteKnowledgeChunk,
  fetchKnowledge,
  previewKnowledge,
  reindexKnowledge,
  type KnowledgeChunkItem,
  type KnowledgePreviewResponse,
} from "@/lib/api/knowledge";

const LOCATIONS = [
  { id: "", label: "All locations (global)" },
  { id: "manchester", label: "Manchester" },
  { id: "leeds", label: "Leeds" },
  { id: "bolton", label: "Bolton" },
  { id: "stockport", label: "Stockport" },
];

type Tab = "library" | "test";

export function KnowledgePanel({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<Tab>("library");
  const [chunks, setChunks] = useState<KnowledgeChunkItem[]>([]);
  const [ingestMeta, setIngestMeta] = useState<{
    count: number;
    at: string | null;
  }>({ count: 0, at: null });
  const [status, setStatus] = useState({ ragEnabled: false, aiEnabled: false });
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [addLocationId, setAddLocationId] = useState("");

  const [testQuery, setTestQuery] = useState(
    "How much does kids BJJ cost and when are classes?"
  );
  const [testLocationId, setTestLocationId] = useState("manchester");
  const [testInterest, setTestInterest] = useState("Kids BJJ");
  const [preview, setPreview] = useState<KnowledgePreviewResponse | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchKnowledge();
      setChunks(data.chunks);
      setIngestMeta({
        count: data.ingest.chunk_count,
        at: data.ingest.ingested_at,
      });
      setStatus(data.status);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load knowledge");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  if (!open) return null;

  const handleAdd = async () => {
    if (!title.trim() || !text.trim()) return;
    setBusy("add");
    setError(null);
    setMessage(null);
    try {
      await createKnowledgeChunk({
        title: title.trim(),
        text: text.trim(),
        locationId: addLocationId || null,
      });
      setTitle("");
      setText("");
      setMessage("Knowledge added and indexed.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Add failed");
    } finally {
      setBusy(null);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Remove this knowledge chunk from RAG?")) return;
    setBusy(id);
    setError(null);
    try {
      await deleteKnowledgeChunk(id);
      setMessage("Chunk removed.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setBusy(null);
    }
  };

  const handleReindex = async () => {
    setBusy("reindex");
    setError(null);
    try {
      const result = await reindexKnowledge();
      setMessage(result.message);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Re-index failed");
    } finally {
      setBusy(null);
    }
  };

  const handlePreview = async () => {
    if (!testQuery.trim()) return;
    setBusy("preview");
    setError(null);
    setPreview(null);
    try {
      const result = await previewKnowledge({
        query: testQuery.trim(),
        locationId: testLocationId || undefined,
        interest: testInterest.trim() || undefined,
      });
      setPreview(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Preview failed");
    } finally {
      setBusy(null);
    }
  };

  const portalChunks = chunks.filter((c) => c.origin === "portal");
  const bundledChunks = chunks.filter((c) => c.origin === "bundled");

  return (
    <div className="admin-overlay" role="dialog" aria-modal="true">
      <button
        type="button"
        className="admin-backdrop"
        aria-label="Close"
        onClick={onClose}
      />
      <div className="knowledge-panel">
        <div className="admin-panel-header">
          <h2>AI knowledge</h2>
          <button type="button" className="admin-close" onClick={onClose}>
            ×
          </button>
        </div>

        <p className="admin-intro">
          Manage what the AI can use when replying (RAG). Portal entries are
          saved to the database and Vectorize. Bundled demo FAQs ship with the
          app.
        </p>

        <div className="knowledge-status">
          <span className={status.ragEnabled ? "knowledge-pill ok" : "knowledge-pill"}>
            RAG {status.ragEnabled ? "on" : "off"}
          </span>
          <span className={status.aiEnabled ? "knowledge-pill ok" : "knowledge-pill"}>
            AI {status.aiEnabled ? "on" : "off"}
          </span>
          <span className="knowledge-meta">
            {ingestMeta.count} chunks indexed
            {ingestMeta.at ? ` · ${ingestMeta.at}` : ""}
          </span>
        </div>

        <div className="knowledge-tabs">
          <button
            type="button"
            className={tab === "library" ? "knowledge-tab active" : "knowledge-tab"}
            onClick={() => setTab("library")}
          >
            Library
          </button>
          <button
            type="button"
            className={tab === "test" ? "knowledge-tab active" : "knowledge-tab"}
            onClick={() => setTab("test")}
          >
            Test RAG
          </button>
        </div>

        {tab === "library" && (
          <>
            <section className="admin-section">
              <h3>Add knowledge</h3>
              <label className="admin-label" htmlFor="k-title">
                Title
              </label>
              <input
                id="k-title"
                className="admin-input"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Summer camp 2026"
              />
              <label className="admin-label" htmlFor="k-loc">
                Location
              </label>
              <select
                id="k-loc"
                className="admin-input admin-select"
                value={addLocationId}
                onChange={(e) => setAddLocationId(e.target.value)}
              >
                {LOCATIONS.map((l) => (
                  <option key={l.id || "global"} value={l.id}>
                    {l.label}
                  </option>
                ))}
              </select>
              <label className="admin-label" htmlFor="k-text">
                Content
              </label>
              <textarea
                id="k-text"
                className="admin-input knowledge-textarea"
                rows={4}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Facts the AI should use — pricing, schedules, policies…"
              />
              <button
                type="button"
                className="admin-btn admin-btn-secondary"
                disabled={busy !== null || !title.trim() || !text.trim()}
                onClick={() => void handleAdd()}
              >
                {busy === "add" ? "Adding…" : "Add to knowledge base"}
              </button>
            </section>

            <section className="admin-section">
              <div className="knowledge-section-head">
                <h3>In RAG ({chunks.length})</h3>
                <button
                  type="button"
                  className="knowledge-link-btn"
                  disabled={busy !== null}
                  onClick={() => void handleReindex()}
                >
                  {busy === "reindex" ? "Re-indexing…" : "Re-index all"}
                </button>
              </div>

              {loading ? (
                <p className="knowledge-empty">Loading…</p>
              ) : (
                <>
                  {portalChunks.length > 0 && (
                    <div className="knowledge-group">
                      <div className="knowledge-group-label">Your entries</div>
                      <ul className="knowledge-list">
                        {portalChunks.map((c) => (
                          <KnowledgeChunkCard
                            key={c.id}
                            chunk={c}
                            busy={busy === c.id}
                            onDelete={() => void handleDelete(c.id)}
                          />
                        ))}
                      </ul>
                    </div>
                  )}

                  {bundledChunks.length > 0 && (
                    <div className="knowledge-group">
                      <div className="knowledge-group-label">Bundled demo</div>
                      <ul className="knowledge-list">
                        {bundledChunks.map((c) => (
                          <KnowledgeChunkCard key={c.id} chunk={c} />
                        ))}
                      </ul>
                    </div>
                  )}

                  {chunks.length === 0 && (
                    <p className="knowledge-empty">No knowledge yet.</p>
                  )}
                </>
              )}
            </section>
          </>
        )}

        {tab === "test" && (
          <section className="admin-section">
            <h3>Test retrieval &amp; reply</h3>
            <p>
              Simulates what RAG finds and how the AI might reply — without
              sending SMS.
            </p>
            <label className="admin-label" htmlFor="t-query">
              Test message
            </label>
            <textarea
              id="t-query"
              className="admin-input knowledge-textarea"
              rows={3}
              value={testQuery}
              onChange={(e) => setTestQuery(e.target.value)}
            />
            <label className="admin-label" htmlFor="t-loc">
              Location
            </label>
            <select
              id="t-loc"
              className="admin-input admin-select"
              value={testLocationId}
              onChange={(e) => setTestLocationId(e.target.value)}
            >
              {LOCATIONS.filter((l) => l.id).map((l) => (
                <option key={l.id} value={l.id}>
                  {l.label}
                </option>
              ))}
            </select>
            <label className="admin-label" htmlFor="t-interest">
              Interest
            </label>
            <input
              id="t-interest"
              className="admin-input"
              value={testInterest}
              onChange={(e) => setTestInterest(e.target.value)}
            />
            <button
              type="button"
              className="admin-btn admin-btn-secondary"
              disabled={busy !== null}
              onClick={() => void handlePreview()}
            >
              {busy === "preview" ? "Running…" : "Run preview"}
            </button>

            {preview && (
              <div className="knowledge-preview">
                <h4>Retrieved chunks ({preview.chunks.length})</h4>
                {preview.chunks.length === 0 ? (
                  <p className="knowledge-empty">
                    No chunks matched. Try re-indexing or adding knowledge.
                  </p>
                ) : (
                  <ul className="knowledge-list">
                    {preview.chunks.map((c) => (
                      <li key={c.id} className="knowledge-card">
                        <div className="knowledge-card-head">
                          <strong>{c.title}</strong>
                          <span className="knowledge-score">
                            {(c.score * 100).toFixed(0)}% match
                          </span>
                        </div>
                        <p className="knowledge-card-text">{c.text}</p>
                        <div className="knowledge-card-meta">
                          {c.locationId ?? "global"} · {c.source}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}

                <h4>Sample AI reply</h4>
                {preview.sampleReply ? (
                  <div className="knowledge-sample-reply">{preview.sampleReply}</div>
                ) : (
                  <p className="knowledge-empty">
                    {preview.aiEnabled
                      ? "Could not generate sample reply."
                      : "AI disabled on worker."}
                  </p>
                )}
              </div>
            )}
          </section>
        )}

        {message && <p className="admin-success">{message}</p>}
        {error && <p className="admin-error">{error}</p>}
      </div>
    </div>
  );
}

function KnowledgeChunkCard({
  chunk,
  busy,
  onDelete,
}: {
  chunk: KnowledgeChunkItem;
  busy?: boolean;
  onDelete?: () => void;
}) {
  return (
    <li className="knowledge-card">
      <div className="knowledge-card-head">
        <strong>{chunk.title}</strong>
        <span className="knowledge-origin">{chunk.origin}</span>
      </div>
      <p className="knowledge-card-text">{chunk.text}</p>
      <div className="knowledge-card-meta">
        {chunk.locationId ?? "global"}
        {chunk.source ? ` · ${chunk.source}` : ""}
      </div>
      {chunk.editable && onDelete && (
        <button
          type="button"
          className="knowledge-delete-btn"
          disabled={busy}
          onClick={onDelete}
        >
          {busy ? "Removing…" : "Remove"}
        </button>
      )}
    </li>
  );
}
