# Lead Intake API (Cloudflare Worker)

REST + SSE API backed by D1. Async AI via Cloudflare Queues, **Workers AI**, and **Vectorize RAG**.

## AI pipeline

1. Queue consumer loads lead thread + `ai_config` from D1
2. Embeds inbound text → queries Vectorize (`pdc-{client-slug}-knowledge`)
3. **Llama 3.3 70B** generates a JSON reply grounded in knowledge
4. **Llama 3.1 8B** judge + rule checks → Approve / Rewrite / Hold
5. Saves message + reasoning; optional Twilio SMS (safe fallback on Hold)

Set `AI_DISABLED=true` in `[vars]` to use template stubs without Workers AI.

## Endpoints

All routes require a valid staff session cookie **except** the public ones marked below
(`/health`, `POST /leads/intake`, `/auth/*`, `/webhooks/*`). See the root README "Set up Resend
(staff sign-in email)" section for the auth model.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check (public) |
| POST | `/auth/magic-link` | Request a sign-in link (public) |
| GET | `/auth/verify` | Verify token, set session cookie, redirect (public) |
| POST | `/auth/logout` | Clear session |
| GET | `/auth/me` | Current staff user |
| PATCH | `/auth/profile` | Set display name (onboarding) |
| GET | `/auth/team` | List team (admins only) |
| POST | `/auth/team/invite` | Invite a teammate (admins only) |
| POST | `/admin/seed` | Seed demo data — only when `ENABLE_DEMO_TOOLS=true` |
| GET | `/admin/ai-config` | Persona + ingest metadata |
| GET | `/admin/ai-status` | AI/RAG binding status |
| POST | `/admin/ingest-knowledge` | Re-index knowledge (`{ "confirm": "INGEST KNOWLEDGE" }`) |
| GET | `/admin/knowledge` | List bundled + portal knowledge chunks |
| POST | `/admin/knowledge` | Add portal chunk (auto-indexed) |
| DELETE | `/admin/knowledge/:id` | Remove portal chunk |
| POST | `/admin/knowledge/reindex` | Re-index all chunks |
| POST | `/admin/knowledge/preview` | Test RAG retrieval + sample reply |
| GET | `/admin/twilio-check` | Verify Twilio credentials |
| GET | `/locations` | List locations |
| GET | `/leads` | Grouped lead list |
| GET | `/leads/:id` | Full lead + thread |
| POST | `/leads/:id/select` | Mark read |
| POST | `/leads/:id/takeover` | Pause AI |
| POST | `/leads/intake` | Website form → queue AI (public) |
| POST | `/leads/simulate` | Simulate a lead — only when `ENABLE_DEMO_TOOLS=true` |
| GET | `/events/stream` | SSE (cookie via `withCredentials`) |
| POST | `/webhooks/twilio` | Inbound SMS |

## Remote deploy

```bash
# From repo root
pnpm deploy:remote
```

This applies D1 migrations, creates Vectorize index (if missing), deploys Worker, seeds D1, and ingests knowledge.

Manual steps:

```bash
cd workers/api
pnpm vectorize:create   # once per account
pnpm db:migrate:remote
pnpm deploy
pnpm db:seed:remote
pnpm knowledge:ingest:remote
```

## Local setup

```bash
pnpm db:migrate:local
pnpm dev:worker
curl -X POST http://localhost:8787/admin/seed
curl -X POST http://localhost:8787/admin/ingest-knowledge \
  -H "Content-Type: application/json" \
  -d '{"confirm":"INGEST KNOWLEDGE"}'
```

Use `wrangler dev --remote` for Workers AI + Vectorize bindings locally, or `AI_DISABLED=true` for offline stubs.

## Knowledge content

Edit chunks in [`packages/knowledge/src/index.ts`](../../packages/knowledge/src/index.ts), then `POST /admin/ingest-knowledge`.

## Secrets (`.dev.vars`)

```
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_MESSAGING_SERVICE_SID=
ADMIN_SEED_SECRET=
```

See [TWILIO.md](./TWILIO.md) for SMS setup.
