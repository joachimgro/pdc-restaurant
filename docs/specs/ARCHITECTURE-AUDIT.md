# ARCHITECTURE-AUDIT.md

**Repo audited:** `/Users/phiof/Documents/GitHub/pdc-phiof`  
**Audit date:** 2026-08-03  
**Purpose:** Drop-in implementation spec source for two new modules (reservations + waitlist). Another AI with zero codebase access should be able to implement against this document alone.

> **Which repo is canonical?** Use **`pdc-phiof`**, not `pdc-template`.  
> `pdc-phiof` is the live Phiof Digital client fork (`ORGANIZATION_ID=phiof`, Worker `pdc-phiof`, D1 `pdc-phiof-db`). It tracks `upstream` (`pdc-template`) and contains the most recent demo work (Anthem Tuition music schedules, single booking-flow seed thread, Stripe–Xero mock plugin, calendar updates).  
> `pdc-template` is the upstream platform repo; optional features live on `feat/*` branches there and are merged into client forks on demand.

---

## 1. Repo topology

### Monorepo tool & package manager

| Item | Value |
|------|-------|
| Package manager | **pnpm 10.15.0** (`packageManager` in root `package.json`) |
| Workspace config | `pnpm-workspace.yaml` → `apps/*`, `workers/*`, `packages/*` |
| Build orchestration | **Turbo** (`turbo.json`) — `build`, `dev` tasks |
| Root package name | `pdc-template` (legacy name retained in `package.json`) |

### Workspace layout

```
pdc-phiof/
├── apps/web/                    # Next.js 15 dashboard (@lead-intake/web)
├── workers/api/                 # Cloudflare Worker API (@lead-intake/api)
├── packages/
│   ├── shared-types/            # Zod schemas + TS types (lead, contact, auth, events, intake)
│   ├── seed-data/               # Demo leads, tuition/music schedules, simulate fixtures
│   └── knowledge/               # KnowledgeChunk type; KNOWLEDGE_CHUNKS array is empty (D1 is source of truth)
├── demos/                       # Client demo profiles + knowledge packs (ideal-centre, oldham-tuition)
├── scripts/                     # deploy-remote.sh, setup-*-demo.mjs, seed-demo-knowledge.mjs
├── docs/                        # plugins.md, demos/*
└── profiles/                    # Wrangler profile templates
```

### Every app/package and purpose

| Package | Path | Purpose |
|---------|------|---------|
| `@lead-intake/web` | `apps/web` | Staff inbox dashboard (Next.js App Router). Single-page shell at `/inbox` with plugin workspaces via `?view=` |
| `@lead-intake/api` | `workers/api` | Cloudflare Worker: HTTP router, webhooks, queue consumer, scheduled handler, AI pipeline |
| `@lead-intake/shared-types` | `packages/shared-types` | Shared Zod schemas: `Lead`, `Contact`, `StaffUser`, `DomainEvent`, `IntakeForm`, `TrialProposal`, etc. |
| `@lead-intake/seed-data` | `packages/seed-data` | Demo seed leads (`buildTuitionDemoLeads`), `TUITION_ASSESSMENT_PROGRAMMES`, `TUITION_OLIVIA_SIMULATE` |
| `@lead-intake/knowledge` | `packages/knowledge` | `KnowledgeChunk` interface only; bundled chunks array is empty |

### Branches & branching strategy

**`pdc-phiof` remotes:**

| Remote | URL |
|--------|-----|
| `origin` | `https://github.com/joachimgro/pdc-phiof.git` |
| `upstream` | `https://github.com/joachimgro/pdc-template.git` |

**Local branches (pdc-phiof):** `main` (default), `feat/wix-channel`, `feat/wix-import`

**Upstream branches (pdc-template):** `main`, `feat/bookings`, `feat/people-crm`, `feat/staff-tasks`, `feat/wix-channel`, `feat/wix-import`

**Documented strategy** (`README.md`, `ARCHITECTURE.md`, `docs/plugins.md`):

1. Platform core lives on `pdc-template` `main`.
2. Optional features are developed on `feat/*` branches in the template repo.
3. Client forks (`pdc-phiof`, etc.) merge `upstream/main` for platform fixes and selectively merge `feat/*` branches.
4. After merging a feature branch: run `pnpm deploy:remote` (migrations before Worker deploy).
5. **No CI enforcement** — branching is manual and ad hoc.

### How plugins/modules are separated today

**Honest assessment: ad hoc, compile-time, not a runtime module system.**

| Layer | Mechanism | Enable switch |
|-------|-----------|---------------|
| **Web UI plugins** | Self-registering modules in `apps/web/src/plugins/*/index.tsx` calling `registerPlugin()` or `registerSettingsSection()` | **Single import** in `apps/web/src/plugins/index.ts` |
| **Web plugin registry** | In-memory `Map` in `apps/web/src/plugins/registry.ts` | Read at render time by `NavRail.tsx`, `InboxPage.tsx`, `SettingsWorkspace.tsx` |
| **Worker plugins** | Directories under `workers/api/src/plugins/*` with logic imported by route shims in `workers/api/src/routes/*` | Routes manually registered in `workers/api/src/index.ts` — **no feature flag loader** |
| **Feature flags (runtime)** | Env vars in `wrangler.toml`: `ENABLE_DEMO_TOOLS`, `ENABLE_SIMPLE_SCHEDULING`, `ENABLE_MULTI_LOCATION` | Read via `workers/api/src/capabilities.ts` |
| **Schema gating** | `EXPECTED_SCHEMA_VERSION` in `workers/api/src/meta.ts` (currently `"0033"`) | Worker refuses all traffic (503) if D1 is behind |

**Registered web plugins (current `apps/web/src/plugins/index.ts`):**

| Plugin dir | Registry ID | Type | Backend routes |
|------------|-------------|------|----------------|
| `people-crm/` | `people` | Nav rail | `/crm/*` |
| `calendar/` | `calendar` | Nav rail | `GET /calendar/sessions` |
| `staff-tasks/` | `my-tasks` | Nav rail | `/my-tasks`, `/assign`, `/staff`, `/triage/refresh-assignments` |
| `stripe-xero-reconciliation/` | `reconciliation` | Nav rail | **NOT PRESENT** (mock UI only) |
| `wix-channel/` | `integrations` | Settings tab | `/wix/*`, `/webhooks/wix` |
| `wix-import/` | `wix-import` | Settings tab | `/wix/import/*` |
| `stripe-xero-reconciliation/settings.tsx` | `stripe-xero` | Settings tab | **NOT PRESENT** |

**Worker plugin directories:**

- `workers/api/src/plugins/people-crm/` — CRM DB, inbound sync, outreach, lifecycle
- `workers/api/src/plugins/calendar/` — sessions, proposals, filter-sessions
- `workers/api/src/plugins/staff-tasks/` — assignee, my-tasks
- `workers/api/src/plugins/wix-channel/` — OAuth, webhooks, Wix client
- `workers/api/src/plugins/wix-import/` — contact/conversation import jobs

**Cross-cutting core imports (not via registry):**

- `ProfilePeopleLink` from `people-crm` imported directly in `apps/web/src/components/inbox/ProfilePanel/ProfilePanel.tsx`

### Build / dev / deploy commands

**Root (`package.json`):**

```bash
pnpm dev              # turbo dev --filter=@lead-intake/web  → localhost:3000
pnpm dev:worker       # turbo dev --filter=@lead-intake/api → localhost:8787
pnpm build            # turbo build (all packages)
pnpm db:migrate:local # wrangler d1 migrations apply --local
pnpm db:migrate:remote
pnpm db:seed:local    # curl POST localhost:8787/admin/seed
pnpm db:seed:remote   # node workers/api/scripts/seed-remote.mjs
pnpm deploy:remote    # bash scripts/deploy-remote.sh
pnpm setup:remote     # install + deploy:remote + build
```

**Worker (`workers/api/package.json`):**

```bash
pnpm dev              # wrangler dev (port 8787)
pnpm deploy           # gen-build-info + wrangler deploy
pnpm test             # vitest run (13 test files, worker only)
```

**Web (`apps/web/package.json`):**

```bash
pnpm dev              # next dev --port 3000
pnpm build            # next build
pnpm start            # next start
pnpm lint             # next lint
```

**Full remote deploy (`scripts/deploy-remote.sh`):** install → D1 migrations → ensure Vectorize + DLQ + KV → gen-build-info → wrangler deploy → health check → POST `/admin/ingest-knowledge` → write `apps/web/.env.local` with `NEXT_PUBLIC_API_URL`.

---

## 2. Cloudflare Workers layer

### `wrangler.toml` (secrets redacted)

**File:** `workers/api/wrangler.toml`

```toml
name = "pdc-phiof"
main = "src/index.ts"
compatibility_date = "2025-06-01"
account_id = "<REDACTED>"

[vars]
ORGANIZATION_ID = "phiof"
CORS_ORIGIN = "http://localhost:3000,http://127.0.0.1:3000"
AI_EMBED_MODEL = "@cf/baai/bge-base-en-v1.5"
ENABLE_DEMO_TOOLS = "true"
ENABLE_SIMPLE_SCHEDULING = "true"
ENABLE_MULTI_LOCATION = "false"
AUTH_FROM_EMAIL = "hello@phiof.digital"
AUTH_WEB_ORIGIN = "http://localhost:3000"

[ai]
binding = "AI"

[[vectorize]]
binding = "KNOWLEDGE"
index_name = "pdc-phiof-knowledge"

[[d1_databases]]
binding = "DB"
database_name = "pdc-phiof-db"
database_id = "<REDACTED>"
migrations_dir = "migrations"

[[queues.producers]]
binding = "AI_QUEUE"
queue = "pdc-phiof-queue"

[[queues.consumers]]
queue = "pdc-phiof-queue"
max_batch_size = 1
max_batch_timeout = 5
max_retries = 3
dead_letter_queue = "pdc-phiof-dlq"

[[kv_namespaces]]
binding = "RATE_LIMITS"
id = "<REDACTED>"

[dev]
port = 8787
```

### Bindings inventory

| Binding | Type | Resource | Present? |
|---------|------|----------|----------|
| `DB` | D1 | `pdc-phiof-db` | Yes |
| `AI` | Workers AI | platform | Yes |
| `KNOWLEDGE` | Vectorize | `pdc-phiof-knowledge` (768-dim, cosine) | Yes |
| `AI_QUEUE` | Queue (producer + consumer) | `pdc-phiof-queue` | Yes |
| DLQ | Queue (consumer config only) | `pdc-phiof-dlq` | Yes |
| `RATE_LIMITS` | KV | namespace id in wrangler | Yes |
| `R2` | — | — | **NOT PRESENT** |
| Durable Objects | — | — | **NOT PRESENT** |
| Hyperdrive | — | — | **NOT PRESENT** |

### Router / framework

**Raw Cloudflare Worker `fetch` handler** — **NOT Hono, NOT itty-router.**

**Entry:** `workers/api/src/index.ts` exports `default { fetch, queue, scheduled }`.

**Request pipeline (`fetch`):**

1. `OPTIONS` → `optionsResponse()` (`workers/api/src/cors.ts`)
2. Demo warning if `ENABLE_DEMO_TOOLS === "true"`
3. `GET /health` → bypasses schema gate
4. `verifySchemaVersion(env)` → 503 on mismatch (`workers/api/src/meta.ts`)
5. Auth gate: `getStaffSession()` OR `adminSecretAuthorized()` unless public route
6. Sequential `if (path === …)` dispatch to route handlers
7. Unmatched → 404 `{ error: "Not found" }`
8. Outer catch → 500 `{ error: message }`

### Route inventory

| Method | Path | Handler | Purpose |
|--------|------|---------|---------|
| `OPTIONS` | `*` | `optionsResponse` | CORS preflight |
| `GET` | `/health` | `handleHealth` | D1/schema/vectorize/AI diagnostics (public, no schema gate) |
| `POST` | `/admin/seed` | `handleAdminSeed` | Seed demo leads + schedules (`force` body supported); 403 if demo tools off |
| `POST` | `/admin/schedules/seed-assessments` | `handleSeedAssessmentSchedules` | Seed `TUITION_ASSESSMENT_PROGRAMMES` into D1 |
| `GET` | `/admin/twilio-check` | `handleTwilioCheck` | Verify Twilio credentials |
| `GET` | `/admin/capabilities` | `handleCapabilities` | Return feature flags |
| `GET` | `/admin/ai-config` | `handleAiConfig` | AI persona + presets + ingest meta |
| `PATCH` | `/admin/ai-config` | `handlePatchAiConfig` | Update AI config + RAG re-ingest |
| `POST` | `/admin/ai-config/apply-preset` | `handleApplyAiPreset` | Apply vertical preset JSON |
| `GET` | `/admin/ai-status` | `handleAiStatus` | AI/RAG enabled state |
| `POST` | `/admin/ingest-knowledge` | `handleIngestKnowledge` | Re-index D1 knowledge → Vectorize (public; optional `X-Admin-Secret`) |
| `GET` | `/admin/knowledge` | `handleListKnowledge` | List knowledge chunks |
| `POST` | `/admin/knowledge` | `handleCreateKnowledge` | Create chunk |
| `POST` | `/admin/knowledge/reindex` | `handleReindexKnowledge` | Full reindex |
| `POST` | `/admin/knowledge/preview` | `handlePreviewKnowledge` | RAG preview query |
| `DELETE` | `/admin/knowledge/:id` | `handleDeleteKnowledge` | Delete chunk + vector |
| `GET` | `/locations` | inline D1 | Public location list |
| `GET` | `/admin/locations` | `handleListAdminLocations` | Admin locations + programmes |
| `POST` | `/admin/locations` | `handleCreateLocation` | Create location |
| `PUT` | `/admin/locations/:id` | `handleUpdateLocation` | Update location |
| `PUT` | `/admin/locations/:id/schedules` | `handlePutLocationSchedules` | Replace programme schedule slots |
| `POST` | `/admin/locations/:id/sync-schedules` | `handleSyncLocationSchedules` | Sync schedules to knowledge index |
| `GET` | `/leads` | `handleListLeads` | Grouped lead summaries |
| `POST` | `/leads/simulate` | `handleSimulateNewLead` | Demo simulate lead (403 if demo off) |
| `POST` | `/leads/intake` | `handleIntakeSubmit` | **Public** web intake form |
| `GET` | `/events/stream` | `handleEventStream` | SSE from `domain_events` |
| `POST` | `/auth/magic-link` | `handleMagicLink` | Request sign-in email |
| `GET` | `/auth/verify` | `handleVerify` | Consume magic link → session cookie |
| `POST` | `/auth/logout` | `handleLogout` | Clear session |
| `GET` | `/auth/me` | `handleMe` | Current staff user |
| `PATCH` | `/auth/profile` | `handleUpdateProfile` | Update display name |
| `GET` | `/auth/team` | `handleListTeam` | List team (admin) |
| `POST` | `/auth/team/invite` | `handleInviteTeam` | Invite staff |
| `POST` | `/webhooks/telnyx` | `handleTelnyxWebhook` | Telnyx inbound SMS |
| `POST` | `/webhooks/twilio` | `handleTwilioInbound` | Twilio inbound SMS |
| `POST` | `/webhooks/twilio/status` | `handleTwilioStatus` | Twilio delivery status |
| `POST` | `/webhooks/wix` | `handleWixWebhook` | Wix inbox events |
| `GET` | `/wix/oauth/start` | `handleWixOAuthStart` | Wix OAuth/install start |
| `GET` | `/wix/oauth/callback` | `handleWixOAuthCallback` | Legacy OAuth callback |
| `GET` | `/wix/install/callback` | `handleWixInstallCallback` | Modern install callback |
| `GET` | `/wix/connection` | `handleWixConnectionStatus` | Wix connection status |
| `POST` | `/wix/import/contacts/start` | `handleWixImportContactsStart` | Wix contact import start |
| `POST` | `/wix/import/contacts/step` | `handleWixImportContactsStep` | Wix contact import step |
| `POST` | `/wix/import/conversations/start` | `handleWixImportConversationsStart` | Wix conversation import start |
| `POST` | `/wix/import/conversations/step` | `handleWixImportConversationsStep` | Wix conversation import step |
| `POST` | `/wix/sync-unknown-contacts` | `handleWixSyncUnknownContacts` | Sync unknown Wix contacts |
| `POST` | `/wix/force-backfill-contact` | `handleWixForceBackfillContact` | Force backfill single contact |
| `GET` | `/my-tasks` | `handleMyTasks` | Staff-assigned leads |
| `POST` | `/assign` | `handleAssign` | Assign lead/conversation |
| `POST` | `/triage/refresh-assignments` | `handleRefreshAssignments` | Batch refresh Wix assignees |
| `GET` | `/staff` | `handleListStaff` | Staff list + counts |
| `PUT` | `/staff/display-name` | `handlePutStaffDisplayName` | Update display name |
| `GET` | `/calendar/sessions` | `handleCalendarSessions` | Upcoming sessions (`?weeks=`, `?fromDate=`) |
| `GET` | `/crm/contacts` | `handleListContacts` | List CRM contacts |
| `POST` | `/crm/contacts` | `handleCreateContact` | Create contact |
| `GET` | `/crm/outreach/preview` | `handleOutreachPreview` | Preview outreach SMS |
| `POST` | `/crm/backfill-from-leads` | `handleBackfillContacts` | Backfill contacts from leads |
| `GET` | `/crm/tags` | `handleListTags` | List tags |
| `POST` | `/crm/tags` | `handleCreateTag` | Create tag |
| `GET` | `/crm/contacts/:id` | `handleGetContact` | Contact detail |
| `PATCH` | `/crm/contacts/:id` | `handlePatchContact` | Update contact |
| `DELETE` | `/crm/contacts/:id` | `handleDeleteContact` | Delete contact |
| `PUT` | `/crm/contacts/:id/identifiers` | `handleSetContactIdentifiers` | Replace identifiers |
| `PUT` | `/crm/contacts/:id/tags` | `handleSetContactTags` | Set tags |
| `POST` | `/crm/contacts/:id/notes` | `handleAddContactNote` | Add note |
| `POST` | `/crm/contacts/:id/key-dates` | `handleCreateKeyDate` | Create key date |
| `PATCH` | `/crm/contacts/:id/key-dates/:keyDateId` | `handlePatchKeyDate` | Update key date |
| `DELETE` | `/crm/contacts/:id/key-dates/:keyDateId` | `handleDeleteKeyDate` | Delete key date |
| `POST` | `/leads/:id/notes` | `handleAddLeadNote` | Add lead note |
| `POST` | `/leads/:id/messages` | `handleSendStaffMessage` | Staff outbound message |
| `POST` | `/leads/:id/select` | `handleSelectLead` | Mark read + return detail |
| `POST` | `/leads/:id/takeover` | `handleTakeover` | Pause AI |
| `POST` | `/leads/:id/resume-ai` | `handleResumeAi` | Resume AI |
| `GET` | `/leads/:id` | `handleGetLead` | Lead thread + profile |
| `DELETE` | `/leads/:id` | `handleDeleteLead` | Delete lead |

**Non-HTTP handlers:**

| Export | Handler | File | Purpose |
|--------|---------|------|---------|
| `queue` | `handleQueueBatch` | `workers/api/src/queue/consumer.ts` | Process `AI_QUEUE` messages |
| `scheduled` | inline | `workers/api/src/index.ts` | `refreshLeadAssignmentsBatch` if Wix connected — **no cron trigger in wrangler** |

### Error handling envelope

- Success: `jsonResponse(request, env, data, status?)` → JSON body + CORS headers
- Errors: `{ error: string }` with HTTP status (400, 401, 403, 404, 409, 500, 503)
- Schema mismatch: 503 `{ error: "Service unavailable: schema mismatch", details }`
- No unified error code enum or trace IDs

### Logging & observability

| Mechanism | File | Notes |
|-----------|------|-------|
| `logger.info/warn/error` | `workers/api/src/log.ts` | JSON: `{ level, org, msg, ts }` |
| `console.*` | Throughout | Demo warnings, schema errors, dev magic-link URL |
| `/health` | `workers/api/src/routes/health.ts` | `checks.schema`, `checks.d1`, `checks.vectorize`, `checks.ai_usage`; `version.gitSha` from `build-info.ts` |
| Workers Observability binding | — | **NOT PRESENT** in wrangler |
| Sentry / Datadog | — | **NOT PRESENT** |

---

## 3. Data layer

### Migration system

| Item | Value |
|------|-------|
| Tool | Cloudflare Wrangler D1 migrations |
| Folder | `workers/api/migrations/` |
| Naming | `NNNN_descriptive_snake_case.sql` (33 files, `0001`–`0033`) |
| Version tracking | `_meta` table, key `schema_version`; each migration updates it |
| Expected version | `EXPECTED_SCHEMA_VERSION = "0033"` in `workers/api/src/meta.ts` |
| Local apply | `pnpm db:migrate:local` |
| Remote apply | `pnpm db:migrate:remote` or `scripts/deploy-remote.sh` |
| Prod gate | Worker refuses traffic if D1 version < expected |

### Full current D1 schema (consolidated DDL, post-0033)

> This is the **effective schema** after applying all 33 migrations. Individual migration files are incremental; see `workers/api/migrations/` for history. Empty/no-op migrations: `0004`, `0008`, `0010`.

```sql
-- Meta
CREATE TABLE IF NOT EXISTS _meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Core org
CREATE TABLE IF NOT EXISTS organizations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS locations (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  name TEXT NOT NULL,
  abbrev TEXT NOT NULL,
  badge_count INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Leads (inbox threads)
CREATE TABLE IF NOT EXISTS leads (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  location_id TEXT REFERENCES locations(id),          -- nullable since 0015
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  time_label TEXT NOT NULL,
  status TEXT NOT NULL,
  status_label TEXT NOT NULL,
  assessment TEXT NOT NULL,
  preview TEXT NOT NULL,
  unread INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL,
  interest TEXT NOT NULL,
  child_json TEXT,
  list_group TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  ai_paused INTEGER NOT NULL DEFAULT 0,
  just_arrived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  trial_slot TEXT,                                    -- 0005
  trial_slot_label TEXT,                            -- 0005
  trial_proposed_json TEXT,                         -- 0007
  trial_confirmed_at TEXT,                          -- 0007
  location_confirmed INTEGER NOT NULL DEFAULT 1,    -- 0009
  notes TEXT,                                       -- 0011 (legacy inline)
  contact_id TEXT,                                  -- 0029
  messaging_channel TEXT NOT NULL DEFAULT 'twilio', -- 0023
  wix_conversation_id TEXT,                         -- 0023
  wix_contact_id TEXT,                              -- 0023
  wix_target_channel TEXT DEFAULT 'SMS',            -- 0023
  wix_assignee_id TEXT,                             -- 0028
  wix_assignee_name TEXT,                           -- 0028
  wix_assignee_email TEXT,                          -- 0028
  wix_assigned_at TEXT,                             -- 0028
  dashboard_assignee_email TEXT                     -- 0028
);
CREATE INDEX IF NOT EXISTS idx_leads_org ON leads(organization_id);
CREATE INDEX IF NOT EXISTS idx_leads_location ON leads(location_id);
CREATE INDEX IF NOT EXISTS idx_leads_phone ON leads(phone);
CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_org_phone ON leads(organization_id, phone);
CREATE INDEX IF NOT EXISTS idx_leads_contact ON leads(organization_id, contact_id);
CREATE INDEX IF NOT EXISTS idx_leads_wix_conv ON leads(organization_id, wix_conversation_id);
CREATE INDEX IF NOT EXISTS idx_leads_wix_assignee_email ON leads(organization_id, wix_assignee_email);
CREATE INDEX IF NOT EXISTS idx_leads_dashboard_assignee_email ON leads(organization_id, dashboard_assignee_email);

-- Messages
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  lead_id TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL,
  kind TEXT NOT NULL,
  from_role TEXT,
  body TEXT,
  time_label TEXT,
  day_label TEXT,
  auto_followup_label TEXT,
  staff_user_id TEXT REFERENCES staff_users(id),
  staff_author_name TEXT,
  external_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_messages_lead ON messages(lead_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_messages_external ON messages(lead_id, external_id) WHERE external_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS message_reasoning (
  message_id TEXT PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
  verdict TEXT NOT NULL,
  stage TEXT NOT NULL,
  note TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS timeline_events (
  id TEXT PRIMARY KEY,
  lead_id TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL,
  time_label TEXT NOT NULL,
  parts_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS lead_notes (
  id TEXT PRIMARY KEY,
  lead_id TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  author_name TEXT NOT NULL,
  author_user_id TEXT,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_lead_notes_lead ON lead_notes(lead_id);

-- Events
CREATE TABLE IF NOT EXISTS domain_events (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_domain_events_created ON domain_events(created_at);
CREATE INDEX IF NOT EXISTS idx_domain_events_org_created ON domain_events(organization_id, created_at);

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  external_id TEXT NOT NULL,
  processed_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(provider, external_id)
);

-- AI config
CREATE TABLE IF NOT EXISTS ai_config (
  organization_id TEXT PRIMARY KEY REFERENCES organizations(id),
  academy_name TEXT NOT NULL,
  tone TEXT NOT NULL,
  goals TEXT NOT NULL,
  rules TEXT NOT NULL,
  model_reply TEXT NOT NULL DEFAULT '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
  model_judge TEXT NOT NULL DEFAULT '@cf/meta/llama-3.1-8b-instruct',
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  safe_fallback_message TEXT,
  intake_context_label TEXT,
  qualification_enabled INTEGER DEFAULT 1,
  required_fields TEXT,
  field_labels TEXT,
  programme_aliases TEXT,
  qualification_templates TEXT,
  preset_id TEXT,
  auto_reply_enabled INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS ai_location_overrides (
  location_id TEXT PRIMARY KEY REFERENCES locations(id),
  extra_context TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ai_ingest_meta (
  organization_id TEXT PRIMARY KEY REFERENCES organizations(id),
  chunk_count INTEGER NOT NULL DEFAULT 0,
  ingested_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS knowledge_chunks (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  location_id TEXT,
  title TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'portal',
  text TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_org ON knowledge_chunks(organization_id);

-- Scheduling
CREATE TABLE IF NOT EXISTS location_programme_schedules (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  location_id TEXT NOT NULL REFERENCES locations(id),
  programme TEXT NOT NULL,
  day_of_week TEXT NOT NULL,
  start_time TEXT NOT NULL,
  display_label TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_schedules_location ON location_programme_schedules(location_id, programme);

-- Staff auth
CREATE TABLE IF NOT EXISTS staff_users (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  email TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  role TEXT NOT NULL DEFAULT 'member',
  display_name TEXT,
  profile_complete INTEGER DEFAULT 0,
  invited_by TEXT REFERENCES staff_users(id),
  status TEXT NOT NULL DEFAULT 'active',
  UNIQUE(organization_id, email)
);

CREATE TABLE IF NOT EXISTS staff_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES staff_users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_staff_sessions_hash ON staff_sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_staff_sessions_user ON staff_sessions(user_id);

CREATE TABLE IF NOT EXISTS magic_link_tokens (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_magic_link_hash ON magic_link_tokens(token_hash);

CREATE TABLE IF NOT EXISTS staff_activity_log (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  staff_user_id TEXT NOT NULL REFERENCES staff_users(id),
  staff_display_name TEXT NOT NULL,
  action TEXT NOT NULL,
  lead_id TEXT,
  metadata_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_staff_activity_org ON staff_activity_log(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_staff_activity_user ON staff_activity_log(staff_user_id);
CREATE INDEX IF NOT EXISTS idx_staff_activity_lead ON staff_activity_log(lead_id);

-- Processing locks
CREATE TABLE IF NOT EXISTS queue_processing_locks (
  queue_message_id TEXT PRIMARY KEY,
  lead_id TEXT NOT NULL,
  sms_sent_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS lead_processing_locks (
  lead_id TEXT PRIMARY KEY,
  locked_at TEXT NOT NULL,
  locked_by_queue_message_id TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_lead_locks_expires ON lead_processing_locks(expires_at);

-- Wix
CREATE TABLE IF NOT EXISTS wix_connections (
  organization_id TEXT PRIMARY KEY,
  wix_instance_id TEXT,
  wix_site_id TEXT,
  access_token_enc TEXT NOT NULL,
  refresh_token_enc TEXT,
  expires_at INTEGER NOT NULL,
  scopes_json TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_wix_connections_instance ON wix_connections(wix_instance_id);

CREATE TABLE IF NOT EXISTS wix_oauth_states (
  state TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_wix_oauth_states_org ON wix_oauth_states(organization_id);

CREATE TABLE IF NOT EXISTS wix_webhook_events (
  id TEXT PRIMARY KEY,
  organization_id TEXT,
  topic TEXT NOT NULL,
  received_at INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  process_status TEXT DEFAULT 'PROCESSED'
);
CREATE INDEX IF NOT EXISTS idx_wix_webhook_events_org ON wix_webhook_events(organization_id);

CREATE TABLE IF NOT EXISTS wix_contact_import_jobs (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  offset_ INTEGER DEFAULT 0,
  imported_count INTEGER DEFAULT 0,
  total_count INTEGER,
  status TEXT DEFAULT 'running',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS wix_conversation_import_jobs (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  range_start_ms INTEGER NOT NULL,
  range_end_ms INTEGER NOT NULL,
  conversation_ids_json TEXT NOT NULL,
  conv_index INTEGER DEFAULT 0,
  message_cursor TEXT,
  conversations_processed INTEGER DEFAULT 0,
  messages_imported INTEGER DEFAULT 0,
  status TEXT DEFAULT 'running',
  error_text TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- People CRM
CREATE TABLE IF NOT EXISTS contacts (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  name TEXT NOT NULL,
  phone_e164 TEXT,              -- vestigial since 0032; nullable
  email TEXT,                   -- vestigial since 0032; nullable
  lifecycle TEXT NOT NULL DEFAULT 'new',
  source_first_seen TEXT,
  source_last_seen TEXT,
  primary_lead_id TEXT,
  location_id TEXT,
  interest TEXT,
  child_json TEXT,
  last_message_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_contacts_org_lifecycle ON contacts(organization_id, lifecycle);
CREATE INDEX IF NOT EXISTS idx_contacts_org_last_message ON contacts(organization_id, last_message_at);
CREATE INDEX IF NOT EXISTS idx_contacts_primary_lead ON contacts(organization_id, primary_lead_id);

CREATE TABLE IF NOT EXISTS contact_identifiers (
  id TEXT PRIMARY KEY,
  contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  organization_id TEXT NOT NULL,
  type TEXT NOT NULL,
  value TEXT NOT NULL,
  label TEXT,
  is_primary INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(organization_id, type, value)
);
CREATE INDEX IF NOT EXISTS idx_contact_identifiers_contact ON contact_identifiers(contact_id);
CREATE INDEX IF NOT EXISTS idx_contact_identifiers_lookup ON contact_identifiers(organization_id, type, value);
CREATE INDEX IF NOT EXISTS idx_contact_identifiers_primary ON contact_identifiers(contact_id, is_primary) WHERE is_primary = 1;

CREATE TABLE IF NOT EXISTS contact_tags (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  name TEXT NOT NULL,
  color TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(organization_id, name)
);
CREATE INDEX IF NOT EXISTS idx_contact_tags_org ON contact_tags(organization_id);

CREATE TABLE IF NOT EXISTS contact_tag_links (
  contact_id TEXT NOT NULL,
  tag_id TEXT NOT NULL,
  PRIMARY KEY (contact_id, tag_id),
  FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE CASCADE,
  FOREIGN KEY (tag_id) REFERENCES contact_tags(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS contact_notes (
  id TEXT PRIMARY KEY,
  contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  author_name TEXT NOT NULL,
  author_user_id TEXT,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_contact_notes_contact ON contact_notes(contact_id, created_at);

CREATE TABLE IF NOT EXISTS contact_key_dates (
  id TEXT PRIMARY KEY,
  contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  date TEXT NOT NULL,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_contact_key_dates_contact ON contact_key_dates(contact_id);
```

### Contact identifier architecture

**What is a contact?**

A `contacts` row is an org-scoped person record in the People CRM plugin. It holds lifecycle (`new` | `prospect` | `booked` | `active` | `inactive`), optional vestigial `phone_e164`/`email`, and links to inbox threads via `leads.contact_id`.

**Canonical identity: `contact_identifiers`**

| Column | Purpose |
|--------|---------|
| `type` | `phone` \| `email` \| `instagram` \| `facebook` \| `whatsapp` |
| `value` | Normalized value (E.164 phone, lowercase email, etc.) |
| `is_primary` | 1 = primary identifier for display/outreach |
| **UNIQUE** | `(organization_id, type, value)` — dedupe key |

**Dedupe across channels:**

| Layer | Mechanism | File |
|-------|-----------|------|
| CRM | `findContactByIdentifier(env, type, rawValue)` | `workers/api/src/plugins/people-crm/db.ts` |
| Inbound SMS → CRM | `upsertContactFromInbound()` links lead to contact by phone | `workers/api/src/plugins/people-crm/inbound-sync.ts` |
| Lead inbox | `UNIQUE(organization_id, phone)` on `leads` | migration `0017` |
| Outreach | `findLeadByPhone()` + `sendOutreachWelcome()` | `workers/api/src/plugins/people-crm/outreach.ts` |

**Key functions:**

```typescript
// workers/api/src/plugins/people-crm/db.ts
export function normalizeIdentifierValue(type: string, rawValue: string): string
export async function findContactByIdentifier(env: Env, type: string, rawValue: string): Promise<ContactRow | null>
export async function insertContactIdentifiers(env: Env, contactId: string, identifiers: Array<{type, value, label?}>): Promise<void>
export async function replaceContactIdentifiers(env: Env, contactId: string, raw: Array<{type, value, label?, isPrimary?}>): Promise<void>
export async function linkLeadToContact(env: Env, leadId: string, contactId: string): Promise<void>

// workers/api/src/plugins/people-crm/inbound-sync.ts
export async function upsertContactFromInbound(env: Env, input: InboundContactInput): Promise<string | null>
```

**What migration 0033 changed:**

| Migration | Effect |
|-----------|--------|
| **0030** | Created `contact_identifiers` as canonical identity source |
| **0031** | Backfilled identifiers from `contacts.phone_e164` / `contacts.email` |
| **0032** | Recreated `contacts` table (nullable legacy columns). **Side effect:** `DROP TABLE contacts` CASCADE-deleted all `contact_identifiers` rows from 0031 |
| **0033** | **Repair:** Re-backfills `contact_identifiers` from surviving legacy columns with idempotent `INSERT OR IGNORE` + `NOT EXISTS` guards. Sets `schema_version = '0033'` |

### Multi-tenancy

**Model: deployment-level isolation, not shared-DB multi-tenant.**

Each Worker deployment has:
- One D1 database
- One `ORGANIZATION_ID` env var (`"phiof"`)

**Scoping mechanism:** every org-scoped query binds `env.ORGANIZATION_ID`:

```typescript
// workers/api/src/db/leads.ts
export async function getLead(env: Env, id: string): Promise<Lead | null>
// SELECT * FROM leads WHERE id = ? AND organization_id = ?

// workers/api/src/plugins/people-crm/db.ts
export async function findContactByIdentifier(env: Env, type: string, rawValue: string)
// WHERE ci.organization_id = ? AND ci.type = ? AND ci.value = ?
```

**Tenant hierarchy:**
- `organizations` — one row per deployment
- `locations` — venues within org (`id`, `name`, `abbrev`)
- All leads, contacts, schedules scoped by `organization_id`

**Gaps (no direct `organization_id` filter):**
- `messages`, `contact_notes` — scoped via FK to `leads`/`contacts`
- `magic_link_tokens` — keyed by email only (safe: one org per DB)
- `webhook_deliveries` — global `(provider, external_id)` unique

### ORM / query builder

**NOT PRESENT** — no Drizzle, Kysely, Prisma, or TypeORM.

**Pattern:** raw D1 SQL via `env.DB.prepare(...).bind(...).first() | .all() | .run()`, batch writes via `env.DB.batch()`.

**Representative data-access file:** `workers/api/src/db/leads.ts`

```typescript
export async function getLead(env: Env, id: string): Promise<Lead | null>
export async function listLeadsSummaries(env: Env): Promise<LeadGroups>
export async function updateLeadFields(env: Env, id: string, patch: LeadPatch): Promise<void>
export async function insertMessage(env: Env, leadId: string, message: Message): Promise<string>
```

---

## 4. Auth & security (current state, warts included)

### Staff/dashboard auth

| Item | Detail |
|------|--------|
| Provider | Custom magic-link via **Resend** |
| Flow | `POST /auth/magic-link` → email → `GET /auth/verify?token=` → session cookie |
| Cookie name | `lead_intake_session` (`SESSION_COOKIE` in `workers/api/src/auth/crypto.ts`) |
| Token storage | SHA-256 hash in `staff_sessions.token_hash` (raw token never stored) |
| Session TTL | 30 days |
| Magic link TTL | 15 minutes |
| Session lookup | `getStaffSession(env, request)` → joins `staff_sessions` + `staff_users`, filters `organization_id` |

**Key functions (`workers/api/src/auth/session.ts`):**

```typescript
export async function createMagicLinkToken(env: Env, email: string): Promise<string>
export async function consumeMagicLinkToken(env: Env, rawToken: string): Promise<string | null>
export async function createSession(env: Env, userId: string): Promise<string>
export async function getStaffSession(env: Env, request: Request): Promise<StaffSession | null>
export function sessionCookieHeader(token: string, maxAgeSec: number, secure?: boolean): string
```

### RBAC

**Roles (`workers/api/src/auth/constants.ts`, `staff.ts`):**

| Role | DB value | Capabilities |
|------|----------|--------------|
| `superadmin` | hardcoded email `joachim@phiof.digital` | `canManageTeam` + `canAssignAdmins` |
| `admin` | `admin` | `canManageTeam`; can invite `member` only |
| `member` | `member` | Standard staff access |

```typescript
export function canManageTeam(role: StaffRole): boolean
export function canAssignAdmins(role: StaffRole): boolean
export function canInviteRole(actorRole: StaffRole, targetRole: StaffRole): boolean
```

**Enforcement locations:**
- Global gate: `workers/api/src/index.ts` — session required for all non-public routes
- Team routes: `routes/auth.ts` — `handleListTeam`, `handleInviteTeam`
- Wix import: `routes/wix-import.ts` — `canManageTeam`
- CRM backfill: `routes/people-crm.ts` — `canManageTeam`
- **Most routes:** session only, no per-route role check beyond admin team management

### Public / unauthenticated endpoints

| Path | Protection |
|------|------------|
| `GET /health` | None |
| `POST /leads/intake` | Zod validation only — **no auth, no rate limit, no Turnstile** |
| `POST /admin/ingest-knowledge` | Optional `X-Admin-Secret`; else confirm phrase in body |
| `/auth/*` | Self-managed magic-link flow |
| `/webhooks/telnyx` | Ed25519 signature (`verifyTelnyxWebhook`) |
| `/webhooks/twilio*` | HMAC signature (skippable via `TWILIO_SKIP_SIGNATURE_VALIDATION`) |
| `/webhooks/wix` | Wix JWT public key |
| Wix OAuth callbacks | OAuth state tokens |

**Admin secret bypass (`workers/api/src/auth/admin-secret.ts`):**

```typescript
export function adminSecretAuthorized(request: Request, env: Env): boolean
// X-Admin-Secret === env.ADMIN_SEED_SECRET → bypasses session for ALL routes
```

### Secrets management

| Secret | Purpose |
|--------|---------|
| `RESEND_API_KEY` | Magic-link email |
| `TELNYX_API_KEY`, `TELNYX_FROM_NUMBER`, `TELNYX_WEBHOOK_PUBLIC_KEY` | Telnyx SMS |
| `TWILIO_*` | Twilio SMS (alternative channel) |
| `ADMIN_SEED_SECRET` | Operator script auth |
| `WIX_APP_ID`, `WIX_APP_SECRET`, `WIX_WEBHOOK_PUBLIC_KEY`, `ENCRYPTION_KEY` | Wix OAuth |
| `AI_DISABLED` | Stub AI instead of Workers AI |

Set via `wrangler secret put`. Documented in `workers/api/.dev.vars.example`.

### CORS

`workers/api/src/cors.ts`:
- Origins from comma-separated `CORS_ORIGIN`
- `Access-Control-Allow-Credentials: true`
- Allowed headers: `Content-Type`, `Authorization`, `Last-Event-ID`
- Session cookie: `SameSite=None; Secure` in production

### CSP headers

**NOT PRESENT** — no Content-Security-Policy headers set by Worker or Next.js config observed.

### Turnstile / bot protection on public forms

**NOT PRESENT**

### PII stored

| Table / field | PII |
|---------------|-----|
| `leads.name`, `leads.phone`, `leads.child_json` | Parent/child names, phone, age |
| `messages.body` | Conversation content |
| `contacts.*`, `contact_identifiers.value` | Names, phones, emails, social handles |
| `staff_users.email` | Staff email |
| `wix_connections.access_token_enc` | Encrypted OAuth tokens |

### Retention / erasure

**NOT PRESENT** as automated policy. Manual deletion available:
- `DELETE /leads/:id` — deletes lead + cascaded messages/timeline
- `DELETE /crm/contacts/:id` — deletes contact + cascaded identifiers/notes
- No GDPR export endpoint, no scheduled purge, no anonymization job

---

## 5. Messaging

### Resend (email)

**Scope:** Staff auth magic links only. No lead/customer transactional email.

| Item | Detail |
|------|--------|
| Wiring | `workers/api/src/email/magic-link.ts` → `fetch("https://api.resend.com/emails")` |
| Templates | Inline HTML string — **NOT React Email, NOT Resend template IDs** |
| From | `env.AUTH_FROM_EMAIL` (`hello@phiof.digital`) |
| Dev fallback | No key → localhost returns `{ devVerifyUrl }`; production → 503 |

```typescript
export async function sendMagicLinkEmail(env: Env, to: string, verifyUrl: string): Promise<void>
```

### Telnyx SMS

| Item | Detail |
|------|--------|
| Inbound | `POST /webhooks/telnyx` → `handleTelnyxWebhook()` → `processInboundSms({ provider: "telnyx" })` |
| Signature | Ed25519 via `verifyTelnyxWebhook()` (`workers/api/src/auth/telnyx-verify.ts`) |
| Outbound | `sendTelnyxSms()` (`workers/api/src/telnyx/send.ts`) |
| Routing | `sendLeadMessage()` checks `leads.messaging_channel === "telnyx"` |
| CRM outreach | `workers/api/src/plugins/people-crm/outreach.ts` prefers Telnyx when configured |

```typescript
export async function handleTelnyxWebhook(request: Request, env: Env): Promise<Response>
export async function sendTelnyxSms(env: Env, to: string, body: string): Promise<SendTelnyxSmsResult | null>
export async function sendLeadMessage(env: Env, leadId: string, text: string, opts?: {...}): Promise<SendLeadMessageResult>
```

**Rate limits:** No Telnyx-specific rate limiting. AI calls rate-limited via KV (see below).

**Cost assumptions:** **NOT DOCUMENTED** in repo.

### Twilio SMS (alternative)

Still supported: `POST /webhooks/twilio`, `POST /webhooks/twilio/status`. Signature validation skippable in dev via `TWILIO_SKIP_SIGNATURE_VALIDATION=true`.

### Queues / cron

**Queue config (`wrangler.toml`):**

```
Producer: AI_QUEUE → pdc-phiof-queue
Consumer: max_batch_size=1, max_retries=3, DLQ=pdc-phiof-dlq
```

**Message types (`workers/api/src/env.ts`):**

```typescript
type QueueMessage =
  | { type: "process_inbound"; leadId: string; messageId: string }
  | { type: "simulate_ai_reply"; leadId: string };
```

**Consumer (`workers/api/src/queue/consumer.ts`):**

```typescript
export async function handleQueueBatch(batch: MessageBatch<QueueMessage>, env: Env): Promise<void>
```

**Behavior:**
1. Per-message send lock (`queue_processing_locks`) — skip if SMS already sent
2. Per-lead lock (`lead_processing_locks`, 2 min TTL) — `msg.retry({ delaySeconds: 5 })` if locked
3. AI rate limit check (`checkAiRateLimit`)
4. `generateAiReply()` → insert outbound message → send SMS
5. On success: `msg.ack()`
6. On permanent failure (≥3 attempts): `recordPermanentFailure()` + `msg.ack()` (sets lead assessment to manual-response warning)
7. DLQ catches unacked crashes; app acks most failures explicitly

**Enqueue:**

```typescript
export async function queueInboundAi(env: Env, leadId: string, messageId: string): Promise<void>
```

**Scheduled handler:**

```typescript
// workers/api/src/index.ts
async scheduled(_event, env, ctx): Promise<void>
// refreshLeadAssignmentsBatch(env, 50) when Wix connected
```

**Cron trigger in wrangler:** **NOT PRESENT** — handler exists but is never invoked.

**AI rate limits (`workers/api/src/ai/rate-limit.ts`):**

- KV binding `RATE_LIMITS`
- `SOFT_WARN_THRESHOLD = 500`, `HARD_LIMIT = 1000` per org per hour
- `checkAiRateLimit(env)`, `recordAiCall(env)`

---

## 6. Next.js dashboard

### Version & stack

| Item | Value |
|------|-------|
| Next.js | `^15.3.4` |
| React | `^19.1.0` |
| Tailwind | `^4.1.10` (CSS-first, no `tailwind.config.*`) |
| State | Zustand `^5.0.5` |
| Validation | Zod via `@lead-intake/shared-types` |

### App Router structure

```
apps/web/src/app/
├── layout.tsx          # Root layout, imports globals.css
├── page.tsx            # Redirect → /inbox
├── globals.css         # Design tokens ("Soft Bubble" theme)
├── inbox/page.tsx      # Main shell → <InboxPage />
├── login/page.tsx      # Magic-link login
├── lead/page.tsx       # Public intake form
├── lead/lead.css
├── settings/page.tsx   # Redirect → /inbox?view=settings
└── settings/settings.css
```

**Workspaces are NOT separate routes.** Selected via query param on `/inbox`:
- `/inbox` — default inbox
- `/inbox?view=calendar` — calendar plugin
- `/inbox?view=people` — CRM plugin
- `/inbox?view=settings&tab=ai` — settings area

### Data fetching pattern

**Client-side only** — no Server Components data fetching to Worker.

**API client (`apps/web/src/lib/api/client.ts`):**

```typescript
export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787";
export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T>
export async function fetchAuthMe(): Promise<StaffUser | null>
export function subscribeEvents(onEvent: (event: DomainEvent) => void, cursor?: string | null): () => void
```

- All requests use `credentials: "include"` for session cookie
- Responses validated with Zod schemas from `@lead-intake/shared-types`
- Real-time: SSE `GET /events/stream` via `EventSource`

**Auth on client:**
1. `LoginForm` → `POST /auth/magic-link`
2. User clicks email link → Worker `GET /auth/verify` sets cookie
3. `InboxPage` calls `fetchAuthMe()`; 401 → redirect `/login`

### State management

**Zustand store (`apps/web/src/store/inbox-store.ts`):**

```typescript
interface InboxState {
  init(): Promise<void>
  reloadLeads(): Promise<void>
  selectLead(id: string): Promise<void>
  simulateNewLead(): Promise<void>
  toggleAiControl(leadId: string): Promise<void>
  sendStaffMessage(leadId: string, text: string): Promise<void>
  addLeadNote(leadId: string, body: string): Promise<void>
  deleteLead(id: string): Promise<void>
  restoreDemoSeed(): Promise<{ seeded: boolean; count: number }>
  applyEvent(event: DomainEvent): void
  refreshLead(id: string): Promise<void>
}
export const useInboxStore = create<InboxState>(...)
```

### Forms & validation

| Area | Approach |
|------|----------|
| Login | Manual trim + HTML `required` |
| Lead intake (`/lead`) | Local `useState` + server `IntakeFormSchema.safeParse` |
| Settings/AI config | Local state + PATCH to Worker |
| react-hook-form | **NOT PRESENT** |

### Design system

**`--pd-*` variables:** **NOT PRESENT**

**Actual tokens (`apps/web/src/app/globals.css`):**

```css
:root {
  --bg-app:    #0E0F12;
  --panel:     #1A1C20;
  --panel-2:   #232529;
  --elevated:  #2A2C31;
  --input:     #232529;
  --bubble-in: #2A2C31;
  --border:        rgba(255, 255, 255, 0.06);
  --border-strong: rgba(255, 255, 255, 0.11);
  --text:       #F3F4F6;
  --text-mid:   #B6B9C0;
  --text-muted: #82858E;
  --accent:         #FF6B6B;
  --accent-hover:   #FF8585;
  --accent-soft:    rgba(255, 107, 107, 0.14);
  --accent-contrast:#FFFFFF;
  --green:      #34D399;
  --green-soft: rgba(52, 211, 153, 0.14);
  --font: 'Plus Jakarta Sans', system-ui, sans-serif;
  --r-xs: 8px; --r-sm: 10px; --r-md: 14px; --r-lg: 18px; --r-xl: 24px; --r-pill: 999px;
  --radius: 14px;
  --radius-panel: 20px;
  --shadow-sm: 0 1px 2px rgba(0,0,0,0.3);
  --shadow: 0 4px 12px rgba(0,0,0,0.4);
}
```

Theme name: **"Soft Bubble"** — dark background, coral accent (`#FF6B6B`), mint green for positive states.

**Tailwind:** v4 via `@tailwindcss/postcss` in `postcss.config.mjs`. No separate config file.

**Component primitives:** **NOT a component library** (no shadcn/ui, Radix, etc.). Custom components in `apps/web/src/components/inbox/`:

| Component | Path | Props (key) |
|-----------|------|-------------|
| `InboxPage` | `components/inbox/InboxPage.tsx` | Shell: nav + workspace router |
| `NavRail` | `components/inbox/NavRail.tsx` | `activeSection`, `onSectionChange` |
| `LeadsPanel` | `components/inbox/LeadsPanel/LeadsPanel.tsx` | Lead list sidebar |
| `LeadRow` | `components/inbox/LeadsPanel/LeadRow.tsx` | `lead`, `selected`, `onSelect` |
| `ConversationPanel` | `components/inbox/ConversationPanel/ConversationPanel.tsx` | `lead`, staff composer |
| `MessageThread` | `components/inbox/ConversationPanel/MessageThread.tsx` | `lead: Lead` |
| `ProfilePanel` | `components/inbox/ProfilePanel/ProfilePanel.tsx` | `onClose` |
| `Avatar` | `components/inbox/Avatar.tsx` | `name`, `size` |
| `SettingsWorkspace` | `components/inbox/SettingsWorkspace.tsx` | Settings areas + plugin tabs |
| `AiSettingsSection` | `components/inbox/AiSettingsSection.tsx` | AI persona editor |
| `KnowledgeWorkspace` | `components/inbox/KnowledgeWorkspace.tsx` | RAG chunk CRUD |
| `LocationSchedulePanel` | `components/inbox/LocationSchedulePanel.tsx` | Programme schedule editor |
| `TeamSection` | `components/inbox/TeamSection.tsx` | `staffUser: StaffUser` |
| `WorkspacePlaceholder` | `components/inbox/WorkspacePlaceholder.tsx` | `title`, `hint` |
| `ProfileOnboarding` | `components/inbox/ProfileOnboarding.tsx` | First-login name capture |

Plugin workspaces live under `apps/web/src/plugins/*/`.

### Screens today

| Screen | URL / view | Description |
|--------|------------|-------------|
| **Inbox** | `/inbox` | Lead list + conversation thread + profile panel; staff SMS composer |
| **Settings** | `/inbox?view=settings` | Schedule, AI, team, demo tools; plugin settings tabs |
| **Knowledge** | `/inbox?view=knowledge` | RAG chunk CRUD, preview, reindex |
| **Calendar** | `/inbox?view=calendar` | Week grid of taster lesson slots; bookings agenda; session roster |
| **People** | `/inbox?view=people` | CRM contacts, identifiers, lifecycle, tags |
| **My tasks** | `/inbox?view=my-tasks` | Staff-assigned leads needing attention |
| **Reconciliation** | `/inbox?view=reconciliation` | Stripe–Xero mock dashboard (no backend) |
| **Login** | `/login` | Email magic-link sign-in |
| **Lead intake** | `/lead` | Public enquiry form → `POST /leads/intake` |
| **Profile onboarding** | overlay in inbox | First-login display name prompt |

---

## 7. Existing booking/enquiry logic

### End-to-end flow

```
┌─────────────────────────────────────────────────────────────────┐
│ ENTRY POINTS                                                     │
├─────────────────────────────────────────────────────────────────┤
│ SMS: POST /webhooks/telnyx → processInboundSms() → queueInboundAi│
│ Web: POST /leads/intake → createInboundFromIntake() → queue      │
│ Demo: POST /leads/simulate → insert lead + queue simulate_ai_reply│
└──────────────────────────┬──────────────────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│ QUEUE CONSUMER (workers/api/src/queue/consumer.ts)               │
│ handleQueueBatch → generateAiReply(env, leadId, inboundText)     │
└──────────────────────────┬──────────────────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│ AI PIPELINE (workers/api/src/ai/pipeline.ts)                     │
│                                                                  │
│ 1. Welcome turn (website intake) — welcomeReplyFromLead(), no LLM │
│ 2. Topic guard — checkTopic(), injection deflection              │
│ 3. Post-booking — handlePostBookingMessage() if status=booked  │
│ 4. Qualification — needsQualification() → handleQualificationTurn│
│    On complete: may auto buildProposeOptionsReply() + proposeTrial│
│ 5. learnFromMessage() — opportunistic field capture              │
│ 6. Structured booking (if ENABLE_SIMPLE_SCHEDULING):           │
│    runHumanBookingFlow() → resolveScheduleChoice()             │
│    → proposeTrial() / confirmTrial()                           │
│ 7. LLM path — runChatModel(model_reply) → judgeReply()         │
│    → post-process → booking intent backfill                      │
└──────────────────────────┬──────────────────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│ PERSISTENCE (workers/api/src/db/trial-booking.ts)                │
│ proposeTrial() — sets trial_proposed_json, status=qualified      │
│ confirmTrial() — sets trial_slot, trial_confirmed_at, status=booked│
└──────────────────────────┬──────────────────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│ CALENDAR (workers/api/src/plugins/calendar/sessions.ts)          │
│ generateUpcomingSessions() — expands location_programme_schedules│
│ assignBookings() — maps confirmed leads to session slots         │
│ GET /calendar/sessions — dashboard week grid                     │
└─────────────────────────────────────────────────────────────────┘
```

### Key module signatures

```typescript
// workers/api/src/ai/pipeline.ts
export async function generateAiReply(env: Env, leadId: string, inboundText: string): Promise<AiReply>

// workers/api/src/ai/qualification.ts
export function needsQualification(lead: Lead, config: QualificationConfig): boolean
export async function handleQualificationTurn(env: Env, lead: Lead, inboundText: string, config: QualificationConfig): Promise<string | null>
export function parseQualificationReply(text: string, ctx: ParseQualificationContext): QualPatch

// workers/api/src/ai/booking-flow.ts
export function buildProposeOptionsReply(lead: Lead, sessions: CalendarSession[], voice: BookingVoice): string
export function buildConfirmReply(lead: Lead, proposal: TrialProposal, voice: BookingVoice): string
export function resolveScheduleChoice(inboundText: string, proposed: TrialProposal[]): ScheduleChoiceResult

// workers/api/src/ai/run-booking-flow.ts
export async function runHumanBookingFlow(env: Env, leadId: string, lead: Lead, inboundText: string, schedule: ProgrammeSchedule | null, history: ChatMessage[], sessions: CalendarSession[]): Promise<BookingFlowResult | null>

// workers/api/src/db/trial-booking.ts
export async function proposeTrial(env: Env, leadId: string, proposal: TrialProposal): Promise<void>
export async function confirmTrial(env: Env, leadId: string, proposal: TrialProposal, opts?: ConfirmTrialOpts): Promise<ConfirmTrialResult>

// workers/api/src/plugins/calendar/sessions.ts
export async function generateUpcomingSessions(env: Env, opts?: GenerateSessionsOpts): Promise<CalendarSession[]>

// workers/api/src/plugins/calendar/proposals.ts
export function pickNextAvailableSessions(sessions: CalendarSession[], limit?: number): CalendarSession[]
export function proposalFromSession(session: CalendarSession): TrialProposal
```

### Two-stage AI judge pattern

**Stage 1 — Generate:**

- `runChatModel(env, config.model_reply, messages, maxTokens=512, temperature=0.55)`
- `parseGenerateOutput()` → `{ text, stage, note }` (proposed reply)
- Prompts: `buildSystemPrompt()`, `buildCurrentTurnPrompt()` in `workers/api/src/ai/prompt.ts`
- Playbooks: `workers/api/src/ai/playbooks/` (platform + vertical, e.g. `tuition-centre.ts`)
- RAG: `retrieveKnowledge()` from Vectorize

**Stage 2 — Judge:**

```typescript
// workers/api/src/ai/judge.ts
export async function judgeReply(
  env: Env,
  config: AiConfigRow,
  proposedReply: string,
  knowledgeChunks: KnowledgeChunk[],
  generateStage: string,
  generateNote: string
): Promise<JudgeResult>
```

1. **Rule-based checks** (`ruleBasedChecks`): 320 char SMS limit, medical advice detection, price-in-knowledge validation
2. **LLM judge** via `config.model_judge` (`@cf/meta/llama-3.1-8b-instruct`) with `buildJudgeSystemPrompt()` / `buildJudgeUserPrompt()`
3. **Verdicts:** `Approved` | `Rewrite` | `Hold`
4. **Hold** → `getSafeFallbackMessage()` sent instead
5. **Skip judge** when `generated.note` includes `"plain-text"` and `looksLikeHealthyFollowUp()` passes

**Gating:** Judge runs on every LLM-generated reply unless skipped. Qualification and booking-flow replies bypass the LLM entirely (deterministic templates).

### Scheduling / availability / capacity (partial)

| Concept | Implementation | Limitations |
|---------|----------------|-------------|
| **Schedule source** | `location_programme_schedules` table — recurring day+time per programme per location | No one-off overrides, no holidays |
| **Session generation** | `generateUpcomingSessions()` expands schedules N weeks ahead | `DEFAULT_SESSION_CAPACITY = 1` per slot |
| **Booking assignment** | `assignBookings()` maps `trial_confirmed_at` leads to sessions by `trial_slot` + `trial_proposed_json.date` | Approximate match if exact date missing |
| **Proposal picking** | `pickNextAvailableSessions()` — spread across weekdays | Max 3 slots proposed in SMS |
| **Programme matching** | `sessionsForLead()` + `programmeMatches()` | Alias resolution via `programme_aliases` in AI config |
| **Calendar UI** | `CalendarWorkspace` — week grid, bookings agenda, quick-add slot modal | Quick-add writes to `location_programme_schedules` |
| **Seed data** | `TUITION_ASSESSMENT_PROGRAMMES` in `packages/seed-data/src/tuition-assessment-schedules.ts` (Anthem music programmes) | Demo only |

**`TrialProposal` shape (`packages/shared-types/src/lead.ts`):**

```typescript
{
  slotId: string;      // start_time e.g. "10:00"
  day: string;         // day code e.g. "sat"
  label: string;       // "Sat 11 Jul, 10:00 AM"
  displayLabel: string; // "10am"
  date?: string;       // ISO date e.g. "2026-07-11"
}
```

**No reservations table, no waitlist, no hold/expiry, no overbooking rules beyond capacity=1.**

---

## 8. Testing, CI, environments

### Test setup

| Item | Value |
|------|-------|
| Framework | Vitest `^3.2.4` |
| Config | **NOT PRESENT** (`vitest.config.*` missing — uses defaults) |
| Command | `pnpm test` in `workers/api` |
| Test files | **13** (all under `workers/api/src/`) |
| Web tests | **NOT PRESENT** |
| Coverage reporting | **NOT PRESENT** |

**Test files:**

- `ai/ai-config.test.ts`, `booking-options.test.ts`, `qualification.test.ts`, `qual-gate.test.ts`, `playbooks.test.ts`, `programme-resolve.test.ts`, `rag.test.ts`, `handoff.test.ts`
- `lib/sms-copy.test.ts`, `uk-dates.test.ts`
- `plugins/calendar/proposals.test.ts`, `filter-sessions.test.ts`
- `capabilities.test.ts`

### CI pipeline

**NOT PRESENT** — no `.github/workflows/` in repo.

### Preview environments

**NOT PRESENT** — no Cloudflare Pages preview, no per-PR Workers.

### Production deploy

Manual via `scripts/deploy-remote.sh` or `cd workers/api && pnpm deploy`.

Live instance: `https://pdc-phiof.justphiof.workers.dev`

### Environment variable inventory

**`wrangler.toml` `[vars]`:**

| Var | Purpose |
|-----|---------|
| `ORGANIZATION_ID` | Tenant ID for all D1 queries (`"phiof"`) |
| `CORS_ORIGIN` | Comma-separated allowed origins |
| `AI_EMBED_MODEL` | Vectorize embedding model (`@cf/baai/bge-base-en-v1.5`) |
| `ENABLE_DEMO_TOOLS` | Enable `/admin/seed`, `/leads/simulate`, demo settings tab |
| `ENABLE_SIMPLE_SCHEDULING` | Enable slot booking + schedule settings UI |
| `ENABLE_MULTI_LOCATION` | Enable multi-venue qualification |
| `AUTH_FROM_EMAIL` | Resend sender address |
| `AUTH_WEB_ORIGIN` | Post-login redirect origin |

**Secrets (via `wrangler secret put`, typed in `workers/api/src/env.ts`):**

| Secret | Purpose |
|--------|---------|
| `RESEND_API_KEY` | Magic-link email delivery |
| `TELNYX_API_KEY` | Telnyx outbound SMS |
| `TELNYX_FROM_NUMBER` | E.164 sender |
| `TELNYX_MESSAGING_PROFILE_ID` | Alternative to from number |
| `TELNYX_WEBHOOK_PUBLIC_KEY` | Inbound webhook Ed25519 verification |
| `TWILIO_ACCOUNT_SID` | Twilio account |
| `TWILIO_AUTH_TOKEN` | Twilio auth + webhook HMAC |
| `TWILIO_API_KEY_SID` | Twilio API key (alternative auth) |
| `TWILIO_API_KEY_SECRET` | Twilio API key secret |
| `TWILIO_MESSAGING_SERVICE_SID` | Twilio messaging service |
| `TWILIO_FROM_NUMBER` | Twilio from number |
| `TWILIO_SEND_OUTBOUND` | Set `"false"` to skip outbound |
| `TWILIO_SKIP_SIGNATURE_VALIDATION` | Dev only — skip webhook HMAC |
| `ADMIN_SEED_SECRET` | `X-Admin-Secret` header for operator scripts |
| `WIX_APP_ID` | Wix custom app ID |
| `WIX_APP_SECRET` | Wix app secret |
| `WIX_WEBHOOK_PUBLIC_KEY` | Wix webhook JWT verification |
| `ENCRYPTION_KEY` | AES for Wix OAuth token encryption |
| `AI_DISABLED` | Use template stub instead of Workers AI |

**Web (`apps/web/.env.local`):**

| Var | Purpose |
|-----|---------|
| `NEXT_PUBLIC_API_URL` | Worker API base URL (auto-written by deploy script) |

**Root (`.env.example`):**

| Var | Purpose |
|-----|---------|
| `CLOUDFLARE_ACCOUNT_ID` | Deploy scripts |
| `WORKER_URL` | Remote Worker URL for seed scripts |

---

## 9. Constraints and landmines

### Fragile / load-bearing

| Area | Risk |
|------|------|
| **`generateAiReply()` pipeline** | 700+ line orchestrator; qualification, booking, LLM, and judge intertwined. Any change can break SMS flows. |
| **`contact_identifiers` + migration 0032/0033** | Table recreate CASCADE-deleted identifiers once; 0033 repair is idempotent but fragile if repeated incorrectly. |
| **`confirmTrial()` guarded UPDATE** | Uses `WHERE trial_confirmed_at IS NULL` — correct for concurrency but easy to misread. |
| **Schema version gate** | `EXPECTED_SCHEMA_VERSION` must match highest migration; deploy without migrate → 503 for all traffic. |
| **`plugins/calendar/filter-sessions.ts`** | Import path was wrong (`../db/` vs `../../db/`) — breaks Worker build if unfixed. |
| **In-memory plugin registry** | Web plugins only load if imported in `plugins/index.ts`; no runtime discovery. |
| **SSE + domain_events** | Dashboard real-time depends on `domain_events` inserts; missing emit = stale UI. |
| **Lead phone uniqueness** | `UNIQUE(organization_id, phone)` — shared-family phones will fail second lead. |
| **KV rate limit counter** | Documented race under concurrency (`PHASE_4_CHANGELOG.md`). |

### Anthem Tuition demo dependencies (must not regress)

The `pdc-phiof` deployment is currently configured as an **Anthem Tuition music-lessons sales demo**:

| Dependency | Location | Notes |
|------------|----------|-------|
| Demo lead thread | D1 lead `sofia` — Sofia Ramirez, Piano, status `booked` | Seeded via `workers/api/scripts/reseed-demo-d1.mjs` |
| Trial booking fields | `trial_slot`, `trial_slot_label`, `trial_proposed_json`, `trial_confirmed_at` on Sofia lead | Required for calendar booking display |
| Music schedules | `location_programme_schedules` — Piano, Guitar, Violin, Singing, Drums, etc. | Seeded via `seed-assessments-d1.mjs --replace` |
| Location name | `locations.name = 'Anthem Studio'` | Set by reseed script |
| Calendar UI | Sofia appears on Sat 11 Jul 10:00 Piano slot | Requires `ENABLE_SIMPLE_SCHEDULING=true` |
| Stripe–Xero mock | `apps/web/src/plugins/stripe-xero-reconciliation/` | Frontend-only; no backend |
| `ENABLE_DEMO_TOOLS=true` | `wrangler.toml` | Exposes simulate button + restore demo leads |
| Telnyx SMS | Live inbound still works alongside demo data | `POST /webhooks/telnyx` + secrets |

**Stale doc warning:** `FEATURE_REQUIREMENTS.md` says only `people-crm` is installed and Wix routes are removed — **this is outdated**. Current code has all plugins enabled in `plugins/index.ts` and all Worker routes registered.

### Tech debt relevant to reservations/waitlist

| Debt | Impact on new modules |
|------|----------------------|
| No reservations table | Must add migration `0034+` with new tables |
| Capacity hardcoded to 1 | `DEFAULT_SESSION_CAPACITY` in `sessions.ts` — reservations need real capacity model |
| Schedules are recurring only | No date-specific availability, blackout dates, or instructor resources |
| Booking state on `leads` row only | `trial_*` columns are lead-scoped, not contact-scoped; no separate booking entity |
| No waitlist concept | No queue position, notification, or auto-promote logic |
| Plugin pattern is compile-time | New modules need manual route registration in `index.ts` + import in `plugins/index.ts` |
| No event types for booking lifecycle | `domain_events` has `lead.updated` but no `booking.created` / `waitlist.promoted` |
| Single-org deployment | No `location_id` on bookings; multi-location flag exists but unused in Anthem demo |
| Admin secret bypass | `X-Admin-Secret` grants full API access — reservations admin must consider this |
| No CI | New migrations/booking logic has no automated regression gate beyond 13 unit tests |

---

## Recommended insertion points

### Module 1: Reservations

**Backend:**

1. **New migration** `workers/api/migrations/0034_reservations.sql`:
   - Table `reservations` (id, organization_id, location_id, contact_id, lead_id, programme, session_date, start_time, end_time, status, capacity_slot_id, created_at, confirmed_at, cancelled_at, notes)
   - Table `session_capacity` or extend `location_programme_schedules` with `capacity` column
   - Bump `EXPECTED_SCHEMA_VERSION` in `workers/api/src/meta.ts`

2. **New plugin directory** `workers/api/src/plugins/reservations/`:
   - `db.ts` — CRUD, availability check, conflict detection
   - `availability.ts` — expand schedules into bookable slots with remaining capacity
   - `types.ts` — `Reservation`, `AvailabilitySlot`

3. **New route shim** `workers/api/src/routes/reservations.ts`:
   - `GET /reservations` — list for date range
   - `POST /reservations` — create (staff or public)
   - `PATCH /reservations/:id` — confirm/cancel/reschedule
   - `GET /availability` — slots with remaining capacity
   - Register in `workers/api/src/index.ts`

4. **Integrate with booking flow:**
   - `confirmTrial()` in `workers/api/src/db/trial-booking.ts` should also insert `reservations` row and decrement capacity
   - `generateUpcomingSessions()` in `calendar/sessions.ts` should read capacity from reservations, not just `DEFAULT_SESSION_CAPACITY = 1`
   - Emit `domain_events` type `reservation.created` for SSE

**Frontend:**

1. **New plugin** `apps/web/src/plugins/reservations/`:
   - `index.tsx` → `registerPlugin({ id: "reservations", ... })`
   - `ReservationsWorkspace.tsx` — calendar overlay showing capacity, booking list
2. **Import** in `apps/web/src/plugins/index.ts`
3. **API client** `apps/web/src/lib/api/reservations.ts`

### Module 2: Waitlist

**Backend:**

1. **New migration** `workers/api/migrations/0035_waitlist.sql`:
   - Table `waitlist_entries` (id, organization_id, contact_id, lead_id, programme, location_id, preferred_days_json, priority, status, created_at, notified_at, promoted_at, expires_at)
   - Index on `(organization_id, programme, status, priority)`

2. **New plugin directory** `workers/api/src/plugins/waitlist/`:
   - `db.ts` — enqueue, promote, expire
   - `notify.ts` — SMS notification when slot opens (reuse `sendLeadMessage()`)
   - `promote.ts` — auto-promote on cancellation: waitlist entry → reservation

3. **New route shim** `workers/api/src/routes/waitlist.ts`:
   - `GET /waitlist` — list entries by programme/status
   - `POST /waitlist` — add to waitlist (from SMS flow or staff)
   - `POST /waitlist/:id/promote` — manual promote to reservation
   - `DELETE /waitlist/:id` — remove
   - Register in `workers/api/src/index.ts`

4. **Integrate with booking flow:**
   - When `pickNextAvailableSessions()` returns empty → offer waitlist in `buildProposeOptionsReply()` or LLM prompt
   - On `reservation` cancellation → trigger `promoteNextFromWaitlist()`
   - New `domain_events` type `waitlist.promoted` for SSE

**Frontend:**

1. **New plugin** `apps/web/src/plugins/waitlist/`:
   - `index.tsx` → `registerPlugin({ id: "waitlist", ... })`
   - `WaitlistWorkspace.tsx` — queue view, promote/cancel actions
2. **Import** in `apps/web/src/plugins/index.ts`
3. **API client** `apps/web/src/lib/api/waitlist.ts`

### Shared code changes needed for module-style separation

| File | Change |
|------|--------|
| `workers/api/src/meta.ts` | Bump `EXPECTED_SCHEMA_VERSION` per migration |
| `workers/api/src/index.ts` | Register new route handlers (2 import lines + dispatch blocks) |
| `workers/api/src/env.ts` | Optional: `ENABLE_RESERVATIONS`, `ENABLE_WAITLIST` feature flags |
| `workers/api/src/capabilities.ts` | Expose new flags to frontend |
| `workers/api/src/ai/pipeline.ts` | Hook waitlist fallback when no slots available |
| `workers/api/src/db/trial-booking.ts` | Delegate to reservations plugin on confirm |
| `workers/api/src/plugins/calendar/sessions.ts` | Read real capacity from reservations table |
| `packages/shared-types/src/` | Add `Reservation`, `WaitlistEntry` Zod schemas |
| `apps/web/src/plugins/index.ts` | Import new plugin entry points |
| `apps/web/src/plugins/registry.ts` | **No changes needed** — plugins self-register |
| `FEATURE_REQUIREMENTS.md` | Document new plugins + minimum schema version |

### Suggested implementation order

1. Migration + `reservations` plugin + availability API (backend only)
2. Wire `confirmTrial()` → create reservation row
3. Update `generateUpcomingSessions()` to use real capacity
4. Frontend reservations workspace + calendar integration
5. Migration + `waitlist` plugin
6. Wire pipeline fallback → waitlist enqueue
7. Wire cancellation → auto-promote
8. Frontend waitlist workspace
9. Unit tests for availability, promotion, and capacity edge cases
10. Update `EXPECTED_SCHEMA_VERSION`, `FEATURE_REQUIREMENTS.md`, deploy
