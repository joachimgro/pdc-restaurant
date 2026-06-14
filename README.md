# PDC — Phiof Digital Client Template

AI-powered lead intake and SMS follow-up system. Deployed on Cloudflare Workers with D1 (database),
Vectorize (RAG knowledge), Workers AI (LLM), and Queues (async processing). Next.js inbox dashboard.

This is the **canonical template**. Every client deployment is a fork of this repo.

---

## Naming Convention

All resources follow the `pdc-{client-slug}` pattern:

| Resource | Name format | Example |
|---|---|---|
| GitHub repo | `pdc-{client-slug}` | `pdc-acme-bjj` |
| Cloudflare Worker | `pdc-{client-slug}` | `pdc-acme-bjj` |
| D1 database | `pdc-{client-slug}-db` | `pdc-acme-bjj-db` |
| Vectorize index | `pdc-{client-slug}-knowledge` | `pdc-acme-bjj-knowledge` |
| Queue | `pdc-{client-slug}-queue` | `pdc-acme-bjj-queue` |
| ORGANIZATION_ID | `{client-slug}` | `acme-bjj` |

> PDC = Phiof Digital Client. Client slugs should be short, lowercase, and hyphenated.

---

## Starting a New Client Deployment

### 1 — Fork this repo

On GitHub, go to this repo and click **Fork**. Name the fork `pdc-{client-slug}`.

Then clone locally and add this template as the upstream remote (for future bug fixes):

```bash
git clone git@github.com:joachimgro/pdc-{client-slug}.git
cd pdc-{client-slug}
git remote add upstream git@github.com:joachimgro/pdc-template.git
git fetch upstream
```

---

### 2 — Create Cloudflare resources

You need **five** resources in the client's Cloudflare account (plus Workers AI,
which uses a binding only). Run these with `wrangler` (you must
be authenticated: `wrangler login`).

#### D1 database

```bash
wrangler d1 create pdc-{client-slug}-db
```

Copy the `database_id` from the output — you'll need it in wrangler.toml.

#### Vectorize index

```bash
wrangler vectorize create pdc-{client-slug}-knowledge --dimensions=768 --metric=cosine
```

#### Queue

```bash
wrangler queues create pdc-{client-slug}-queue
```

#### Dead-letter queue (DLQ)

Failed AI queue messages land here instead of being dropped silently (see Phase 1):

```bash
wrangler queues create pdc-{client-slug}-dlq
```

Configure `dead_letter_queue` in `workers/api/wrangler.toml` to match.

#### KV namespace (AI rate limiting)

Per-org AI call counters and circuit breaker (optional until configured; rate limiting
is disabled if the binding is absent):

```bash
wrangler kv namespace create RATE_LIMITS
```

Copy the returned `id` into `workers/api/wrangler.toml` under `[[kv_namespaces]]`.

#### Workers AI

Workers AI is enabled automatically via the `[ai]` binding in wrangler.toml — no separate
resource to create.

---

### 3 — Fill in `workers/api/wrangler.toml`

Open `workers/api/wrangler.toml` and replace every `CHANGE_ME`:

```toml
name = "pdc-{client-slug}"            # ← e.g. pdc-acme-bjj
account_id = "..."                     # ← Cloudflare account ID

[vars]
ORGANIZATION_ID = "{client-slug}"      # ← e.g. acme-bjj

[[vectorize]]
index_name = "pdc-{client-slug}-knowledge"

[[d1_databases]]
database_name = "pdc-{client-slug}-db"
database_id = "..."                    # ← from step 2

[[queues.producers]]
queue = "pdc-{client-slug}-queue"

[[queues.consumers]]
queue = "pdc-{client-slug}-queue"
max_retries = 3
dead_letter_queue = "pdc-{client-slug}-dlq"

[[kv_namespaces]]
binding = "RATE_LIMITS"
id = "..."                    # ← from: wrangler kv namespace create RATE_LIMITS
```

> `ENABLE_DEMO_TOOLS` defaults to `"false"`. Set to `"true"` only for demo/dev instances
> to enable `/admin/seed` and `/leads/simulate`.

---

### 4 — Set up Resend (staff sign-in email)

Staff sign in with a **passwordless magic link** sent via [Resend](https://resend.com). You
need a Resend account and a verified sending domain before the login flow works in production.

**How the auth model works**

- **Cookie sessions.** After a staff member clicks their magic link, the Worker sets an
  `HttpOnly`, `Secure`, `SameSite=Lax` session cookie. There is no token in `localStorage`.
- **Invite-only.** Only people who exist in the `staff_users` table can request a link.
  Everyone else gets the same "check your email" response (no account enumeration).
- **Roles.** `admin` and `member`. Admins can manage the team (invite/list). The first time a
  member signs in they complete a quick profile (display name) onboarding step.
- **Hidden platform operator (super admin).** `joachim@phiof.digital` is hardcoded in
  `workers/api/src/auth/constants.ts` and has access to **every** PDC client build. It is never
  shown as a role in the team UI and cannot be removed. This is the same across all clients —
  no env var needed.
- **API protection.** Every Worker route except the public ones (`/health`, the public lead
  intake `POST /leads/intake`, `/auth/*`, and `/webhooks/*`) requires a valid session cookie.
  The frontend sends `credentials: include` on every request (and `withCredentials` on the SSE
  stream), so this is transparent once signed in.

#### 4a — Create a Resend account and verify your domain

1. Sign up at [resend.com](https://resend.com)
2. Go to **Domains** → **Add Domain** and enter the domain you want to send from
   (e.g. `phiofdigital.com`). Resend will give you DNS records to add.
3. Add those records in your DNS provider (Cloudflare DNS, etc.) and click **Verify**.
4. Once verified, your domain is ready to send from.

#### 4b — Get your API key

Go to **API Keys** → **Create API Key** in the Resend dashboard. Copy the key — you'll
only see it once.

#### 4c — Configure the Worker

```bash
cd workers/api

# Store the API key as a secret (never put it in wrangler.toml)
wrangler secret put RESEND_API_KEY
# Paste the key when prompted
```

Then update `workers/api/wrangler.toml` with your verified sender address and the web origin
the magic link should redirect back to after sign-in:

```toml
AUTH_FROM_EMAIL = "noreply@phiofdigital.com"   # must match a verified Resend domain
AUTH_WEB_ORIGIN = "https://your-app.vercel.app" # Next.js origin (defaults to first CORS_ORIGIN)
```

> **Local dev:** If `RESEND_API_KEY` is not set in `.dev.vars`, the magic link verify URL is
> printed to the Worker console (and returned as `devVerifyUrl` on localhost) instead of being
> emailed. This lets you test the full login flow without a Resend account.

#### 4d — First sign-in & inviting your team

The super admin (`joachim@phiof.digital`) can sign in on any deployment immediately — its
`staff_users` row is created automatically on first login. Once signed in, go to the
**Admin panel → Team** to invite the client's own admins and members by email; each invitee
receives a magic link and completes the profile step on first sign-in.

---

### 5 — Set Twilio secrets

Twilio credentials are stored as Worker secrets (never in wrangler.toml or .env):

```bash
cd workers/api

wrangler secret put TWILIO_ACCOUNT_SID
wrangler secret put TWILIO_AUTH_TOKEN
wrangler secret put TWILIO_MESSAGING_SERVICE_SID

# Optional — send from a fixed number instead of Messaging Service:
# wrangler secret put TWILIO_FROM_NUMBER

# Optional — set to "false" to disable outbound SMS (inbox-only mode):
# wrangler secret put TWILIO_SEND_OUTBOUND
```

See `workers/api/TWILIO.md` for the full Twilio webhook setup.

---

### 6 — Add client knowledge

Knowledge chunks are what the AI uses to answer leads' questions. They live in:

```
packages/knowledge/src/index.ts
```

Fill in the `KNOWLEDGE_CHUNKS` array with the client's:

- Conversation style and playbook
- Programme descriptions (what is BJJ, MMA, etc.)
- Pricing and membership terms
- Free trial policy
- Location-specific schedules and details
- FAQ answers

See `docs/knowledge-guide.md` for detailed guidance and chunk templates.

---

### 7 — Populate `packages/seed-data/src/leads.ts`

Update `LOCATIONS` with the client's real locations. These are inserted into the DB on first
seed and shown in the inbox sidebar.

If you're setting up a demo/dev instance with `ENABLE_DEMO_TOOLS=true`, add demo leads to
`rawLeads` and `LEAD_GROUPS` here too. For production deployments, leave these empty.

---

### 8 — Update AI persona in `workers/api/migrations/0002_ai_knowledge.sql`

Uncomment the `INSERT OR IGNORE INTO ai_config` block and fill in:

- `organization_id` — matches `ORGANIZATION_ID` in wrangler.toml
- `academy_name` — the client's business name
- `tone`, `goals`, `rules` — the AI's personality and constraints

This runs automatically on `pnpm db:migrate:remote`. Alternatively, configure via the
Admin panel → AI Config after first deploy.

---

### 9 — Update web app branding

Open `apps/web/src/app/layout.tsx` and update:

```ts
export const metadata: Metadata = {
  title: "Client Academy Name",
  description: "Short description for the tab/SEO",
};
```

Update colours, logo, and any copy in `apps/web/src/app/globals.css` and the component files.

---

### 10 — Deploy

```bash
# From the repo root:
pnpm deploy:remote
```

This script:
1. Installs dependencies
2. Applies D1 migrations (creates tables including the staff auth tables)
3. Ensures the Vectorize index exists
4. Deploys the Worker
5. Ingests knowledge chunks into Vectorize
6. Writes `apps/web/.env.local` with the deployed Worker URL
7. Prints next steps

After deploy, go to the app URL → you'll land on `/login`. Enter the super admin email
(`joachim@phiof.digital`) and you'll receive a magic link — its staff record is created on
first sign-in. From the **Admin panel → Team** you can then invite the client's own admins and
members, configure AI, and verify knowledge is ingested correctly.

---

### 11 — Set the web app CORS origin

Once you know the final web app URL (Vercel, Pages, etc.), update `CORS_ORIGIN` in
`workers/api/wrangler.toml`:

```toml
CORS_ORIGIN = "http://localhost:3000,https://your-client-domain.com"
```

Then redeploy the Worker: `cd workers/api && pnpm exec wrangler deploy`.

---

## Architecture

```
Intake form (web)
       │ POST /leads/intake
       ▼
Cloudflare Worker (pdc-{slug})
       │ stores lead + message → D1
       │ enqueues job → Queue
       ▼
Queue consumer
       │ retrieves relevant knowledge → Vectorize (RAG)
       │ calls Workers AI (LLM) to compose reply
       │ judge LLM validates reply
       │ sends SMS via Twilio
       ▼
Next.js inbox (apps/web)
       │ polls / SSE for live updates
       │ staff can reply, takeover, or configure
```

**Cloudflare bindings:**

| Binding | Type | Purpose |
|---|---|---|
| `DB` | D1 | All relational data (leads, messages, locations, config) |
| `AI` | Workers AI | LLM replies + embedding generation |
| `KNOWLEDGE` | Vectorize | RAG chunk vectors (768-dim cosine) |
| `AI_QUEUE` | Queue | Async AI processing (inbound SMS, intake) |

---

## Development (local)

```bash
# Install dependencies
pnpm install

# Copy and fill in local secrets
cp workers/api/.dev.vars.example workers/api/.dev.vars

# Apply migrations to local D1
pnpm db:migrate:local

# Start the Worker (local D1, no Vectorize)
pnpm dev:worker

# In a separate terminal, start the web app
pnpm dev
```

> Local dev uses a local D1 SQLite file. Vectorize is not available locally — set
> `AI_DISABLED=true` in `.dev.vars` to bypass AI calls during development.

---

## Keeping Client Repos Updated (Bug Fixes)

When a bug is fixed in this template, pull the fix into any client repo:

```bash
# In the client repo (e.g. pdc-acme-bjj)
git fetch upstream
git merge upstream/main
# Resolve any conflicts (usually none unless the client modified core files)
git push
```

Conflicts only occur when both the template and the client modified the same lines.
Keep client customisations in separate files/packages to minimise this.

---

## Adding Optional Features (Feature Branch Workflow)

Optional features (booking form, payment integration, CRM, etc.) live on named branches
of this template:

```
main             — core platform (always clean, no feature code)
feat/booking     — Calendly / Cal.com booking integration
feat/payments    — Stripe membership payments
feat/crm         — Client management / membership records
```

To add a feature to a client repo:

```bash
git fetch upstream
git merge upstream/feat/booking
```

**After merging a feature branch**, read `FEATURE_REQUIREMENTS.md` on that branch
for the minimum `schema_version` and any new migrations. Then always run:

```bash
pnpm deploy:remote
```

This applies D1 migrations **before** deploying Worker code. If you deploy Worker
code without migrating first, the schema gate (`EXPECTED_SCHEMA_VERSION` in
`workers/api/src/meta.ts`) returns HTTP 503 until D1 catches up. Verify with:

```bash
curl https://pdc-{client-slug}.workers.dev/health
```

Bug fixes to a feature branch are pulled the same way. Feature branches never touch
`main` — they are independent and can be mixed and matched per client.

---

## Repo Structure

```
pdc-template/
├── apps/
│   └── web/                    # Next.js 15 inbox dashboard
│       ├── src/app/            # Routes: /inbox, /lead (intake), /settings
│       └── src/components/     # LeadsPanel, ConversationPanel, KnowledgePanel, AdminPanel
├── workers/
│   └── api/                    # Cloudflare Worker
│       ├── wrangler.toml       # ← fill in CHANGE_ME values
│       ├── migrations/         # D1 schema migrations (0001–000N)
│       ├── scripts/            # seed-remote, ingest-knowledge helpers
│       └── src/
│           ├── index.ts        # Request router + queue handler
│           ├── env.ts          # Env bindings interface
│           ├── routes/         # auth, admin, leads, events, webhooks, intake, knowledge, locations
│           ├── auth/           # Staff sessions, magic-link tokens, roles, activity log
│           ├── email/          # Resend magic-link email template
│           ├── ai/             # RAG pipeline, prompt builder, LLM judge, qualification
│           └── queue/          # Queue consumer (async AI processing)
├── packages/
│   ├── knowledge/
│   │   └── src/index.ts        # ← populate KNOWLEDGE_CHUNKS for each client
│   ├── seed-data/
│   │   └── src/leads.ts        # ← populate LOCATIONS (and demo leads if needed)
│   └── shared-types/           # Zod schemas shared between Worker and web
├── scripts/
│   └── deploy-remote.sh        # One-command deploy (migrate + deploy + ingest)
├── docs/
│   └── knowledge-guide.md      # How to write knowledge chunks
└── README.md                   # ← you are here
```

---

## Environment Variables Reference

### Worker (`workers/api/wrangler.toml` `[vars]`)

| Variable | Required | Description |
|---|---|---|
| `ORGANIZATION_ID` | Yes | Unique client slug (e.g. `acme-bjj`) |
| `CORS_ORIGIN` | Yes | Comma-separated allowed origins |
| `AI_EMBED_MODEL` | No | Embedding model (default: `@cf/baai/bge-base-en-v1.5`) |
| `ENABLE_DEMO_TOOLS` | No | Set `"true"` to enable `/admin/seed` and `/leads/simulate` (demo/dev only) |
| `AUTH_FROM_EMAIL` | Yes | Verified Resend sender address for staff sign-in emails |
| `AUTH_WEB_ORIGIN` | No | Web origin to redirect to after sign-in (defaults to first `CORS_ORIGIN`) |

> The super admin (`joachim@phiof.digital`) is hardcoded in `workers/api/src/auth/constants.ts`
> and is the same across every PDC build — there is no super-admin env var.

### Worker secrets (`wrangler secret put`)

| Secret | Required | Description |
|---|---|---|
| `RESEND_API_KEY` | Yes | Resend API key for sending magic link emails |
| `TWILIO_ACCOUNT_SID` | Yes (SMS) | Twilio account SID |
| `TWILIO_AUTH_TOKEN` | Yes (SMS) | Twilio auth token |
| `TWILIO_MESSAGING_SERVICE_SID` | Yes (SMS) | Messaging service SID |
| `TWILIO_FROM_NUMBER` | No | Fixed from-number (alternative to messaging service) |
| `TWILIO_SEND_OUTBOUND` | No | Set `"false"` to suppress outbound SMS |
| `AI_DISABLED` | No | Set `"true"` to stub AI (local testing) |

### Web app (`apps/web/.env.local`)

| Variable | Description |
|---|---|
| `NEXT_PUBLIC_API_URL` | Deployed Worker URL (auto-written by deploy script) |
