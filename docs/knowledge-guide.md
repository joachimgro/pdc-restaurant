# Knowledge Chunk Writing Guide

The AI uses knowledge chunks — short text snippets stored in Cloudflare Vectorize — to answer
leads' questions accurately. Each time a lead sends a message, the AI retrieves the most
relevant chunks and uses them to compose a reply.

---

## What Makes a Good Chunk

- **One idea per chunk.** Don't combine pricing, schedules, and location in one chunk.
- **Under ~400 words** (around 500 tokens). Shorter is usually better.
- **Written in plain English**, not bullet points. The AI reads this verbatim.
- **Specific and factual.** Vague knowledge produces vague replies.
- **Actionable.** Include what the AI should say or do ("always offer the free trial after").

---

## Essential Chunk Categories

Every client deployment should have chunks covering at least:

| Category | What to include |
|---|---|
| Conversation style | How the AI should sound, what to avoid |
| Conversation flow | How to advance from enquiry → trial → membership |
| Free trial policy | How to book, what to bring, what happens |
| Pricing | Ranges, payment options, no-contract policy |
| Classes / programmes | What each class is, who it's for |
| Locations | Per-location: address, class times, parking, contact |
| FAQ | Age requirements, what to wear, cancellation, etc. |

---

## Chunk Template

```ts
{
  id: "unique-kebab-case-id",         // e.g. "faq-pricing", "london-schedule"
  organizationId: "your-org-id",      // must match ORGANIZATION_ID in wrangler.toml
  locationId: null,                   // or "location-slug" for location-specific chunks
  title: "Short descriptive title",   // used in admin UI, not sent to AI
  source: "faq.md",                   // reference label (no need for the file to exist)
  text: "The full chunk text goes here. Write it as if explaining to the AI what to say.",
},
```

---

## Conversation Style Chunk (required)

Always include a style chunk. This controls how the AI sounds.

```ts
{
  id: "conv-style",
  organizationId: "your-org-id",
  locationId: null,
  title: "Conversation style",
  source: "playbook.md",
  text: "Write like a coach texting from the desk — warm, friendly, human. Use contractions " +
        "and short sentences. Good openers: 'Hey!', 'Hi [name] —', 'No worries at all'. " +
        "Avoid corporate language: 'Thank you for your enquiry', 'We would be delighted'. " +
        "Never mention AI or automated systems.",
},
```

---

## Location Chunk Example

```ts
{
  id: "loc-london-hq",
  organizationId: "your-org-id",
  locationId: "london-hq",
  title: "London HQ — schedule and details",
  source: "locations/london-hq.md",
  text: "London HQ is at 12 Example Street, E1 6RF. Adults BJJ: Monday and Wednesday 7pm. " +
        "Kids BJJ (ages 5–14): Tuesday and Thursday 5pm. Free parking behind the building. " +
        "Trial classes run every week — book via text by giving preferred day and time slot.",
},
```

---

## After Editing Chunks

Run the ingest command to push chunks into Vectorize:

```bash
curl -X POST https://pdc-{client-slug}.workers.dev/admin/ingest-knowledge \
  -H "Content-Type: application/json" \
  -d '{"confirm":"INGEST KNOWLEDGE"}'
```

Or use the Admin panel → **Re-ingest Knowledge**.

---

## Checking What's Ingested

Use the Admin panel → **Knowledge** tab to see all stored chunks and test retrieval
with the Preview tool (shows which chunks a given query would retrieve).
