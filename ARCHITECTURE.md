# Lead Intake — Architecture

## Product vs demo

The **dashboard is the demo closer**: owners see conversations in real time, stage colour-coding, and AI reasoning. SMS/Meta are inputs; the inbox is the product surface.

Phase 1 ships a **martial-arts–tuned** dataset (kids BJJ, trials, multi-location) in D1, a live SSE dashboard, and webhook stubs. Telnyx + Claude wire in via env without restructuring.

## Stack

| Layer | Technology |
|-------|------------|
| Frontend | Next.js 15 (App Router) on Vercel or anywhere |
| API + webhooks | Cloudflare Worker |
| Database | D1 (SQLite) — locations as first-class |
| Async AI | Cloudflare Queues → Worker consumer |
| Live UI | SSE (`GET /events/stream`) backed by `domain_events` |
| SMS | Twilio inbound webhook → Worker |
| AI | Workers AI (Llama 3.3 70B) + Vectorize RAG + judge (Llama 3.1 8B) |

## Request flow (inbound SMS)

```
Telnyx POST /webhooks/telnyx
  → validate signature (production)
  → upsert lead by phone + location
  → insert inbound message (D1)
  → insert domain_event (message.created)
  → queue.send({ type: 'process_inbound', leadId, messageId })
  → return 200 immediately (<100ms)

Queue consumer
  → load conversation context + ai_config from D1
  → Vectorize RAG: embed query, retrieve FAQ chunks (org + location)
  → Workers AI: generate JSON reply (or template stub if AI_DISABLED)
  → Workers AI judge: approve | rewrite | hold (+ rule checks)
  → insert outbound message + reasoning
  → insert domain_event (message.created, lead.updated)
  → Twilio outbound SMS (safe fallback on Hold)
```

## Dashboard flow

```
Next.js → GET /leads (grouped list)
       → GET /leads/:id (thread + profile)
       → EventSource /events/stream?cursor=
       → on event: patch local state (lead.created, message.created, …)

POST /leads/simulate → creates Olivia-style lead + queues AI (demo button)
POST /leads/:id/takeover → sets ai_paused, emits lead.updated
```

## D1 schema (summary)

- `organizations` — tenant (single seed org for demo)
- `locations` — Manchester, Leeds, Bolton, Stockport
- `leads` — contact, status, source, interest, assessment, preview, unread, child_json
- `messages` — thread rows with `from_role`, optional `day_label`, `auto_followup_label`
- `message_reasoning` — verdict, stage, note (1:1 with AI messages)
- `ai_config` — org persona, tone, rules, model names
- `ai_location_overrides` — per-location prompt context
- `ai_ingest_meta` — last Vectorize ingest stats
- `timeline_events` — activity feed (structured text, not HTML)
- `domain_events` — outbox for SSE (`type`, `payload` JSON, `created_at`)
- `webhook_deliveries` — idempotency for Telnyx/Meta (future)

## Why D1 over Redis

- Same Cloudflare account, no extra vendor
- SQL schema is easy to show clients
- Migrations in repo (`workers/api/migrations/`)
- Locations and leads are relational from day one

## Async, non-blocky UX

1. **Webhooks never wait on the LLM** — queue only.
2. **Dashboard never polls heavy endpoints** — SSE pushes `domain_events`.
3. **Optimistic UI** — simulate/takeover can patch locally; SSE reconciles.
4. **Typing indicator** — `typing.started` / `typing.stopped` events from queue consumer.

## Future hooks (unchanged contracts)

- `POST /webhooks/telnyx` — same pipeline as simulate
- `POST /webhooks/meta` — Instagram DM adapter → normalize to inbound message
- `POST /admin/ingest-knowledge` — re-index `@lead-intake/knowledge` into Vectorize
- `GET /bookings/availability` — optional booking tool (deferred)
- Multi-tenant: `organization_id` on all tables (already present)

## Remote deployment (default)

Production D1 + Worker live on Cloudflare:

- **Worker:** `https://pdc-{client-slug}.<your-subdomain>.workers.dev`
- **D1:** `pdc-{client-slug}-db` — migrations in `workers/api/migrations/`
- **Queue:** `pdc-{client-slug}-queue`

```bash
pnpm deploy:remote   # migrate (remote) → deploy → seed → update apps/web/.env.local
pnpm dev             # Next.js uses remote API
```

## Local development (optional)

```bash
pnpm install
pnpm db:migrate:local    # D1 migrations + seed
pnpm dev:worker          # wrangler dev :8787
# apps/web/.env.local → NEXT_PUBLIC_API_URL=http://localhost:8787
pnpm dev
```
