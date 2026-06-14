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
import { fetchAdminLocations } from "@/lib/api/locations";
import { WorkspacePlaceholder } from "./WorkspacePlaceholder";

type Tab = "library" | "test";

export function KnowledgeWorkspace() {
  const [tab, setTab] = useState<Tab>("library");
  const [chunks, setChunks] = useState<KnowledgeChunkItem[]>([]);
  const [selectedChunkId, setSelectedChunkId] = useState<string | null>(null);
  const [locationOptions, setLocationOptions] = useState<
    { id: string; label: string }[]
  >([{ id: "", label: "All locations (global)" }]);
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
    "How much does it cost and when are classes?"
  );
  const [testLocationId, setTestLocationId] = useState("");
  const [testInterest, setTestInterest] = useState("");
  const [preview, setPreview] = useState<KnowledgePreviewResponse | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [data, locs] = await Promise.all([
        fetchKnowledge(),
        fetchAdminLocations().catch(() => []),
      ]);
      setChunks(data.chunks);
      setIngestMeta({
        count: data.ingest.chunk_count,
        at: data.ingest.ingested_at,
      });
      setStatus(data.status);
      setLocationOptions([
        { id: "", label: "All locations (global)" },
        ...locs.map((l) => ({ id: l.id, label: l.name })),
      ]);
      if (locs[0]) {
        setTestLocationId((prev) => prev || locs[0].id);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load knowledge");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const selectedChunk = chunks.find((c) => c.id === selectedChunkId) ?? null;
  const portalChunks = chunks.filter((c) => c.origin === "portal");
  const bundledChunks = chunks.filter((c) => c.origin === "bundled");

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
      if (selectedChunkId === id) setSelectedChunkId(null);
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

  return (
    <>
      <aside className="leads workspace-panel">
        <div className="leads-header">
          <div>
            <div className="leads-title">Knowledge</div>
            <div className="leads-count">
              {ingestMeta.count} chunks indexed
            </div>
          </div>
        </div>
        <div className="knowledge-status workspace-knowledge-status">
          <span className={status.ragEnabled ? "knowledge-pill ok" : "knowledge-pill"}>
            RAG {status.ragEnabled ? "on" : "off"}
          </span>
          <span className={status.aiEnabled ? "knowledge-pill ok" : "knowledge-pill"}>
            AI {status.aiEnabled ? "on" : "off"}
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
        <div className="leads-scroll">
          {tab === "library" ? (
            loading ? (
              <div className="leads-empty-filter">Loading…</div>
            ) : chunks.length === 0 ? (
              <div className="leads-empty-filter">No knowledge yet</div>
            ) : (
              <>
                {portalChunks.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className={`workspace-list-item ${selectedChunkId === c.id ? "active" : ""}`}
                    onClick={() => setSelectedChunkId(c.id)}
                  >
                    <span className="workspace-list-item-title">{c.title}</span>
                    <span className="workspace-list-item-meta">
                      {c.locationId ?? "global"} · your entry
                    </span>
                  </button>
                ))}
                {bundledChunks.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className={`workspace-list-item ${selectedChunkId === c.id ? "active" : ""}`}
                    onClick={() => setSelectedChunkId(c.id)}
                  >
                    <span className="workspace-list-item-title">{c.title}</span>
                    <span className="workspace-list-item-meta">
                      bundled demo
                    </span>
                  </button>
                ))}
              </>
            )
          ) : (
            <div className="workspace-panel-intro">
              Run a test retrieval in the main panel — no SMS is sent.
            </div>
          )}
        </div>
      </aside>

      <section className="conversation workspace-main">
        {tab === "library" ? (
          <div className="workspace-main-scroll">
            <div className="workspace-main-header">
              <h2>
                {selectedChunk ? selectedChunk.title : "Add knowledge"}
              </h2>
              <p className="workspace-main-sub">
                Facts the AI uses when replying (RAG). Portal entries are saved
                to the database and Vectorize.
              </p>
            </div>

            {selectedChunk ? (
              <div className="workspace-section">
                <p className="knowledge-card-text">{selectedChunk.text}</p>
                <div className="knowledge-card-meta">
                  {selectedChunk.locationId ?? "global"}
                  {selectedChunk.source ? ` · ${selectedChunk.source}` : ""}
                </div>
                {selectedChunk.editable && (
                  <button
                    type="button"
                    className="workspace-btn workspace-btn--secondary"
                    disabled={busy === selectedChunk.id}
                    onClick={() => void handleDelete(selectedChunk.id)}
                    style={{ marginTop: 12 }}
                  >
                    {busy === selectedChunk.id ? "Removing…" : "Remove chunk"}
                  </button>
                )}
              </div>
            ) : (
              <div className="workspace-section">
                <label className="workspace-label" htmlFor="k-title">
                  Title
                </label>
                <input
                  id="k-title"
                  className="workspace-input"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Summer camp 2026"
                />
                <label className="workspace-label" htmlFor="k-loc">
                  Location
                </label>
                <select
                  id="k-loc"
                  className="workspace-input workspace-select"
                  value={addLocationId}
                  onChange={(e) => setAddLocationId(e.target.value)}
                >
                  {locationOptions.map((l) => (
                    <option key={l.id || "global"} value={l.id}>
                      {l.label}
                    </option>
                  ))}
                </select>
                <label className="workspace-label" htmlFor="k-text">
                  Content
                </label>
                <textarea
                  id="k-text"
                  className="workspace-input workspace-textarea"
                  rows={6}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="Facts the AI should use — pricing, schedules, policies…"
                />
                <button
                  type="button"
                  className="workspace-btn"
                  disabled={busy !== null || !title.trim() || !text.trim()}
                  onClick={() => void handleAdd()}
                >
                  {busy === "add" ? "Adding…" : "Add to knowledge base"}
                </button>
              </div>
            )}

            <div className="workspace-section">
              <button
                type="button"
                className="workspace-btn workspace-btn--secondary"
                disabled={busy !== null}
                onClick={() => void handleReindex()}
              >
                {busy === "reindex" ? "Re-indexing…" : "Re-index all chunks"}
              </button>
            </div>

            {message && <p className="workspace-msg ok">{message}</p>}
            {error && <p className="workspace-msg error">{error}</p>}
          </div>
        ) : (
          <div className="workspace-main-scroll">
            <div className="workspace-main-header">
              <h2>Test retrieval</h2>
              <p className="workspace-main-sub">
                Simulates what RAG finds and how the AI might reply.
              </p>
            </div>
            <label className="workspace-label" htmlFor="t-query">
              Test message
            </label>
            <textarea
              id="t-query"
              className="workspace-input workspace-textarea"
              rows={3}
              value={testQuery}
              onChange={(e) => setTestQuery(e.target.value)}
            />
            <label className="workspace-label" htmlFor="t-loc">
              Location
            </label>
            <select
              id="t-loc"
              className="workspace-input workspace-select"
              value={testLocationId}
              onChange={(e) => setTestLocationId(e.target.value)}
            >
              {locationOptions
                .filter((l) => l.id)
                .map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.label}
                  </option>
                ))}
            </select>
            <label className="workspace-label" htmlFor="t-interest">
              Interest (optional)
            </label>
            <input
              id="t-interest"
              className="workspace-input"
              value={testInterest}
              onChange={(e) => setTestInterest(e.target.value)}
            />
            <button
              type="button"
              className="workspace-btn"
              disabled={busy !== null}
              onClick={() => void handlePreview()}
            >
              {busy === "preview" ? "Running…" : "Run preview"}
            </button>

            {preview && (
              <div className="knowledge-preview workspace-section">
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
                      </li>
                    ))}
                  </ul>
                )}
                <h4>Sample AI reply</h4>
                {preview.sampleReply ? (
                  <div className="knowledge-sample-reply">
                    {preview.sampleReply}
                  </div>
                ) : (
                  <p className="knowledge-empty">
                    {preview.aiEnabled
                      ? "Could not generate sample reply."
                      : "AI disabled on worker."}
                  </p>
                )}
              </div>
            )}

            {error && <p className="workspace-msg error">{error}</p>}
          </div>
        )}
      </section>
    </>
  );
}
