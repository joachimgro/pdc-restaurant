# Knowledge Chunk Writing Guide

The AI uses knowledge chunks — short text snippets stored in D1 and indexed in Cloudflare
Vectorize — to answer leads' questions accurately. Each time a lead sends a message, the AI
retrieves the most relevant chunks and uses them to compose a reply.

**Manage chunks in the Admin panel → Knowledge tab.** Do not edit `packages/knowledge/src/index.ts`
— that file is empty in the base template and exists only for backward compatibility during
migration. Client-specific knowledge belongs in D1 only.

---

## What Makes a Good Chunk

- **One idea per chunk.** Don't combine pricing, schedules, and location in one chunk.
- **Under ~400 words** (around 500 tokens). Shorter is usually better.
- **Written in plain English**, not bullet points. The AI reads this verbatim.
- **Specific and factual.** Vague knowledge produces vague replies.
- **Facts only.** Conversation style and flow live in the platform + vertical playbooks (code), not in knowledge chunks.

---

## What NOT to put in knowledge

Do **not** add chunks for:

- How to sound human, SMS style, or name usage
- Conversation flow playbooks ("acknowledge, fact, forward step")
- Vertical consultative routing (tuition parent tone, gym goal-first routing)

Those are injected automatically from **Settings → AI → Apply preset** (`preset_id` in `ai_config`) plus shared platform rules in code. RAG retrieves **client facts only**; chunks with `source` starting with `conversation/` or `platform/` are excluded from retrieval.

Starter fact templates: `templates/knowledge/tuition-centre-facts.json`, `martial-arts-facts-starter.json`.

---

## Essential fact categories

Every client deployment should have chunks covering at least:

| Category | What to include |
|---|---|
| About / USPs | Who you help, key differentiators |
| Programmes or subjects | What you offer, who it's for |
| Free trial / assessment | What happens, how to book (or handoff) |
| Pricing | Ranges and policies (if published) |
| Locations | Address, session times (informational), contact |
| FAQ | Common parent/customer questions |

---

## Adding Chunks via Admin

1. Open the inbox app and go to **Admin → Knowledge**.
2. Click **Add chunk** and fill in:
   - **Title** — short label for your team (not sent to the AI verbatim).
   - **Text** — the knowledge the AI should use (see examples below).
   - **Location** — leave as global, or scope to a specific location slug.
3. New portal chunks are embedded into Vectorize automatically when AI bindings are configured.
4. Use **Re-ingest Knowledge** after bulk edits or schedule sync changes.

---

## Location chunk example

**Title:** London HQ — schedule and details

**Location:** `london-hq` (must match a location slug in Admin → Locations)

**Text example:**

> London HQ is at 12 Example Street, E1 6RF. Adults classes: Monday and Wednesday 7pm. Kids
> classes (ages 5–14): Tuesday and Thursday 5pm. Free parking behind the building. Trial
> classes run every week — book via text by giving preferred day and time slot.

---

## Re-ingest After Changes

Portal chunks are upserted on create. For a full rebuild (e.g. after deleting many chunks):

```bash
curl -X POST https://pdc-{client-slug}.workers.dev/admin/ingest-knowledge \
  -H "Content-Type: application/json" \
  -d '{"confirm":"INGEST KNOWLEDGE"}'
```

Or use **Admin → Knowledge → Re-ingest Knowledge**.

The ingest pipeline reads D1 `knowledge_chunks` first (portal + schedule sources), then any
remaining bundled chunks from `@lead-intake/knowledge` (empty in the base template).

---

## Checking What's Ingested

Use **Admin → Knowledge** to see all stored chunks and test retrieval with the Preview tool
(shows which chunks a given query would retrieve).
