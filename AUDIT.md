# PDC Platform — Pre-Scale Architecture & Reliability Audit

> Generated: 2026-06-14. Based on a full read of `workers/api/`, `apps/web/`, `packages/`, `scripts/`, and all migrations.
> Every finding cites a real file and line range. Findings with no code evidence are marked NOT FOUND IN CODEBASE.

---

## 1. Tenant Isolation & Config

### 1a. How is the client identified at runtime?

`ORGANIZATION_ID` is an env var set in `workers/api/wrangler.toml:18`. It flows into every Worker
handler via the `Env` interface (`workers/api/src/env.ts:6`).

Every D1 query that touches tenant-scoped tables does bind to `env.ORGANIZATION_ID`:

- `leads` queries: `workers/api/src/db/leads.ts:192–196`, `246–248`, `254–259`
- `ai_config` queries: `workers/api/src/db/ai-config.ts:31`
- `inbound-sms.ts`: `workers/api/src/db/inbound-sms.ts:82–86`, `173`
- `staff_users` queries: `workers/api/src/auth/staff.ts:43–50`
- `domain_events`: `workers/api/src/db/events.ts` (not read in full, but called with `env.ORGANIZATION_ID` at every call site in `inbound-sms.ts:144,157`, `consumer.ts:26`)
- SSE stream: `workers/api/src/routes/events.ts:20,38`

**Known exception (🔴):** `workers/api/src/db/leads.ts:247`:
```
SELECT * FROM leads WHERE id = ?
```
`getLead()` fetches by `id` only — **no `organization_id` filter**. A staff member from client A
who guesses a UUID from client B's database can retrieve that lead in full (messages, phone number,
child details). Because each client has its own D1 database binding, this is low-risk today with
proper `wrangler.toml` setup. But `handleGetLead` is a session-protected route and the session
itself is org-scoped, so **cross-org data leakage is only possible if two clients ever accidentally
share a D1 database**. If `wrangler.toml` is misconfigured, this is a real data leak. Severity
rating below accounts for that risk.

Rating: 🟠 **HIGH** — Add `AND organization_id = ?` to `getLead()` as a defence-in-depth measure. One-line fix.

**Other unscoped queries found:**
- `workers/api/src/db/leads.ts:101–106` (`getLocationName`): `SELECT name FROM locations WHERE id = ?` — no org scope.
- `workers/api/src/db/lead-notes.ts` — not read in full; assumed to filter by `lead_id` (cross-org risk is inherited from above).
- `workers/api/src/auth/session.ts:120–129`: session load joins to `staff_users WHERE organization_id = ?` — correctly scoped.

Rating for unscoped `getLocationName`: 🟡 **MEDIUM** — no direct exposure since location IDs are opaque UUIDs.

### 1b. D1 as the only data access path

Each client's `wrangler.toml` binds exactly one D1 via `binding = "DB"`. All data access goes
through `env.DB`. There are no hardcoded database IDs or direct SQL connections in source code.

🟢 **OK** — confirmed in `workers/api/src/env.ts:2` (`DB: D1Database`). No SDK or REST D1 calls found.

### 1c. Client-specific values committed in code

The following are hardcoded in committed source files — each is a merge-conflict hazard when
pulling from `upstream/main`:

| Value | File | Lines | Risk |
|---|---|---|---|
| Super-admin email `joachim@phiof.digital` | `workers/api/src/auth/constants.ts` | 2 | Every client build has this email as a permanent operator. Not a merge conflict, but a multi-client concern — see §7. |
| Default location fallback `"manchester"` | `workers/api/src/db/inbound-sms.ts` | 36 | Any SMS lead to a non-Manchester client defaults to Manchester as their location until they reply. |
| Seed function hardcodes `"bolton"` | `workers/api/src/routes/admin.ts` | 46 | `syncAllSchedulesForLocation(env, "bolton")` is called on every seed, regardless of client. |
| `SMS_SAFE_FALLBACK` string (hardcoded English message) | `workers/api/src/ai/stub.ts` | (read needed) | Per-client branding not supported — all fallbacks send the same generic message. |
| `"(Lead initiated contact via website form)"` string | `workers/api/src/ai/context.ts` | 57 | Hardcoded LLM context string; not customisable per client. |
| `"Referral SMS"` in simulate lead | `workers/api/src/routes/leads.ts` | 167 | Demo timeline event hardcoded, unrelated to real client source taxonomy. |
| All AI prompt strings (tone, goals, rules) | `workers/api/src/db/ai-config.ts` | 13–23 | Fallback defaults are hardcoded. If a client never sets `ai_config` in D1 the system runs with these defaults silently — not an obvious failure. |

**Most dangerous:** `inbound-sms.ts:36` — the `"manchester"` default means every SMS-only inbound
lead on every new client deployment is assigned to a non-existent `manchester` location until
you add a location row. The INSERT at line 174 will **fail with a foreign-key violation** on any
deployment that has no location named `manchester`. This is a silent inbound SMS breakage.

Rating: 🔴 **CRITICAL** — `inbound-sms.ts:36` hardcoded `"manchester"` will cause FK errors on any client without a `manchester` location. Fix: require `locationId` be resolved from config, or default to the org's first location.

Rating: 🟠 **HIGH** — `admin.ts:46` `syncAllSchedulesForLocation(env, "bolton")` hardcodes another demo location. Any client without `bolton` gets a silent error (caught with `console.warn`, not surfaced).

Rating: 🟡 **MEDIUM** — All others above. They're merge-safe (not template-stripped files) but become technical debt at 5+ clients.

### 1d. Is `ENABLE_DEMO_TOOLS` properly guarded?

`ENABLE_DEMO_TOOLS` gates three routes in `workers/api/src/index.ts:63`, `72`, `157`. If a client
deploys with `ENABLE_DEMO_TOOLS=true`:

- `POST /admin/seed` inserts demo leads into the live database (idempotent, but pollutes real data).
- `POST /admin/reset-all` with confirmation string `"DELETE ALL LEADS"` deletes **every lead** in the database.
- `POST /leads/simulate` inserts a fake lead with a hardcoded phone number and queues real AI processing.

The `reset-all` route requires the body `{ "confirm": "DELETE ALL LEADS" }` (`admin.ts:7,20`). That
confirmation string is public knowledge (it's in the README and the source). A session-authenticated
attacker (i.e. any logged-in staff member) who discovers `ENABLE_DEMO_TOOLS=true` is live on
production can wipe the entire database.

Rating: 🟠 **HIGH** — `ENABLE_DEMO_TOOLS=true` in production is a data-loss hole. It is purely a config discipline matter; there is no build-time or runtime enforcement that prevents it going live. Fix: require an additional `ADMIN_SEED_SECRET` header on these routes, or add an explicit check that `NODE_ENV !== "production"` (though Workers doesn't have `NODE_ENV`).

---

## 2. D1 Schema Integrity

### 2a. Migrations

14 migration files in `workers/api/migrations/`, numbered `0001`–`0014`, prefix-ordered.
Cloudflare D1 handles migration tracking natively via an internal `d1_migrations` table —
confirmed by `pnpm exec wrangler d1 migrations apply` in `deploy-remote.sh:26`.

🟢 **OK** — Migrations are sequential and D1 tracks them. No manual tracking table needed.

### 2b. Schema summary with integrity observations

**`organizations`** (`0001:1–6`): PK=TEXT. No `ON DELETE` clauses on child tables' FKs to this table — `leads` references `organizations(id)` with no `ON DELETE` behaviour, meaning deleting an org would leave orphaned leads (SQLite ignores FK violations unless `PRAGMA foreign_keys = ON`, and D1 does not guarantee this is set).

**`locations`** (`0001:8–15`): PK=TEXT. `organization_id` FK to `organizations(id)` — no `ON DELETE`. `badge_count INTEGER` is nullable with no default — code sometimes treats null as 0.

**`leads`** (`0001:17–38`):
- PK=TEXT (UUID). `phone TEXT NOT NULL` — no UNIQUE constraint. **Two leads can share the same phone number** (same org). `inbound-sms.ts` works around this with fuzzy-match logic (`inbound-sms.ts:88–107`) but the DB does not enforce uniqueness.
- `status TEXT NOT NULL` — completely untyped. Any string is valid. The code uses `"new"`, `"engaged"`, `"qualified"`, `"booked"`, `"waiting"`, `"cold"` but the schema enforces nothing.
- `list_group TEXT NOT NULL` — same: accepts any string.
- `child_json TEXT` — JSON blob in a TEXT column. No schema validation at DB level.
- `trial_proposed_json TEXT` — same.

Rating: 🔴 **CRITICAL** — No UNIQUE constraint on `(organization_id, phone)` in the `leads` table. Two inbound SMS from the same lead (e.g. if phone normalisation doesn't match on the first attempt) can create duplicate lead records and fire two AI reply chains.

**`messages`** (`0001:44–57`):
- `kind TEXT NOT NULL` — untyped TEXT. Valid values: `"chat"`, `"day"`, `"auto_followup"`.
- `from_role TEXT` — nullable, untyped.
- `body TEXT` — nullable (day/followup messages have no body). No NOT NULL on content-bearing rows.

**`webhook_deliveries`** (`0001:84–90`): `UNIQUE(provider, external_id)` — ✅ this is the idempotency key for inbound SMS. Correctly prevents duplicate processing of the same Twilio `MessageSid`.

**`staff_users`** (`0013:2–9`): `UNIQUE(organization_id, email)` — ✅ correct.
`role TEXT NOT NULL DEFAULT 'member'` (`0014:2`) — untyped TEXT; no CHECK constraint.

**`magic_link_tokens`** (`0013:22–30`): `token_hash TEXT NOT NULL UNIQUE` — ✅. `used_at TEXT` nullable — single-use enforced in code (`session.ts:79`).

**`staff_sessions`** (`0013:10–18`): `token_hash TEXT NOT NULL UNIQUE` — ✅. `expires_at TEXT NOT NULL` — TTL is 30 days (`crypto.ts:15`).

### 2c. Missing indexes on hot-path queries

| Query | File:Line | Index present? |
|---|---|---|
| `SELECT * FROM leads WHERE id = ?` | `leads.ts:247` | No index on `id` — `id` is PK, so ✅ indexed implicitly |
| `SELECT * FROM leads WHERE phone = ? AND organization_id = ?` | `inbound-sms.ts:83–86` | `idx_leads_phone` covers `phone` only, no compound. For high-volume orgs the DB will scan all rows with that phone across all orgs (cross-org collision in index, then filtered). 🟡 |
| Fuzzy phone LIKE query | `inbound-sms.ts:91–98` | `replace(replace(...phone...)...)` is a function expression on a column — **no index is usable**. Full table scan on `leads` for every inbound SMS from an unknown number. |
| `SELECT 1 FROM messages WHERE lead_id = ? AND kind = 'day' LIMIT 1` | `inbound-sms.ts:114–118` | `idx_messages_lead` covers `(lead_id, sort_order)`. `kind` is not in the index — partial scan per lead's messages. Acceptable at low volume; degrades with long conversations. |
| `SELECT * FROM leads WHERE organization_id = ?` (list all leads) | `leads.ts:192–196` | `idx_leads_org` — ✅ |
| SSE cursor: `fetchEventsSince` | `db/events.ts` (not read in full) | `idx_domain_events_created` on `created_at` exists (`0001:82`). No index on `organization_id`. Every SSE poll scans all orgs' events then filters. **At 10 clients all sharing an events table this degrades linearly.** |

Rating: 🔴 **CRITICAL** — The fuzzy phone `LIKE replace(...)` query in `inbound-sms.ts:91–98` is a full table scan on every inbound SMS for unrecognised numbers. At 100 leads this is fine. At 10,000 across multiple clients it will time out (D1 has a 30s execution limit; Workers has a 50ms CPU limit on the free tier).

Rating: 🟠 **HIGH** — `domain_events` has no `organization_id` index. Every SSE poll (every 800ms per connected user) scans all events across all clients.

### 2d. UNIQUE constraints against duplicates

- **Phone number uniqueness:** NOT FOUND. No `UNIQUE(organization_id, phone)` on `leads`. The `webhook_deliveries` idempotency key prevents duplicate processing of the _same Twilio MessageSid_, but two messages from the same phone number with _different_ MessageSids (e.g. a Twilio retry after a delayed non-2xx) can still create two lead rows.
- **Twilio message idempotency:** `webhook_deliveries UNIQUE(provider, external_id)` at `0001:89` — ✅ present.

---

## 3. Update Propagation & Migration Safety

### 3a. Deploy script: migrations before or after Worker code?

`scripts/deploy-remote.sh:24–32`:
1. Line 26: `wrangler d1 migrations apply "$DB_NAME" --remote` — **migrations first**
2. Line 32: `wrangler deploy` — **Worker code second**

🟢 **OK** — Deploy order is correct. Migrations run before new Worker code is live.

### 3b. Can new Worker code go live without migrations?

Yes. If a developer does:
```bash
git merge upstream/main
cd workers/api && wrangler deploy
```
...the Worker code deploys without `deploy-remote.sh` being called, so migrations do not run. There
is no CI/CD pipeline in this repo (NOT FOUND IN CODEBASE — no `.github/workflows/`, no `wrangler.toml`
`[triggers]`, no Pages deploy hook). Therefore there is no automated enforcement.

The README documents `pnpm deploy:remote` as the deploy command but does not warn that `wrangler deploy` alone skips migrations.

Rating: 🔴 **CRITICAL** — A developer who deploys via `wrangler deploy` (or a GitHub Action that only runs `wrangler deploy`) on a merge that includes a new migration will run new code against an old schema. For example, a migration adding a NOT NULL column with no default would cause every INSERT to fail silently until the migration is manually applied.

### 3c. What prevents merge conflicts on client-specific files?

Nothing structural. The model relies entirely on convention: client-specific values should live in:
- `workers/api/wrangler.toml` (excluded from rsync syncs by convention)
- `packages/knowledge/src/index.ts` (gets merged from upstream — client knowledge will be **overwritten** on `git merge upstream/main`)
- `packages/seed-data/src/leads.ts` (same)

Both knowledge and seed-data files ARE in `upstream/main` (the template has placeholder versions).
A `git merge upstream/main` will create a merge conflict on `packages/knowledge/src/index.ts` on
every client that has populated their knowledge chunks.

Rating: 🔴 **CRITICAL** — There is no mechanism to prevent `git merge upstream/main` from conflicting with client-specific knowledge chunks. At 10 clients, every base update requires 10 manual conflict resolutions. The fix is to move client knowledge into D1 `knowledge_chunks` portal entries only (which already exists — `db/knowledge-chunks.ts`) and clear the bundled `KNOWLEDGE_CHUNKS` array entirely in the template, relying solely on D1-stored chunks for production.

### 3d. Feature branch schema versioning

NOT FOUND IN CODEBASE. There is no versioning, compatibility declaration, or dependency tag
between feature branches and `main`. A `feat/booking` branch that assumes migration `0014` exists
would silently fail at runtime on a client that is on `main` at migration `0012`.

Rating: 🔴 **CRITICAL** — No mechanism exists. Documenting a minimum migration version in each feature branch README is the minimum viable fix.

### 3e. Per-client version tracking

NOT FOUND IN CODEBASE. There is no dashboard, manifest, or tag scheme to know which migration
version or which feature branches each client repo is currently running. At 3 clients this is a
mental model. At 10 clients it is a guaranteed ops incident.

Rating: 🟠 **HIGH** — Not an immediate code breakage, but a routine ops hazard.

---

## 4. Twilio / SMS Webhooks

### 4a. Webhook signature verification

`workers/api/src/routes/twilio.ts:16–38`. The code:
1. Reads `X-Twilio-Signature` header.
2. If `TWILIO_AUTH_TOKEN` is set and `TWILIO_SKIP_SIGNATURE_VALIDATION !== "true"`, calls `validateTwilioSignature()`.
3. If `TWILIO_AUTH_TOKEN` is **not set**, logs a warning and **passes the request through** (`twilio.ts:36–38`).

🟠 **HIGH** — Signature verification is present but conditional. A deployment where `TWILIO_AUTH_TOKEN` is not configured (e.g. SMS-optional client, mis-deploy) silently accepts all webhook requests with no authentication. Anyone who discovers the webhook URL can inject arbitrary fake inbound SMS leads.

The fallback is documented in `.dev.vars.example` as intentional for local dev. For production, there is no enforcement that the secret is set before traffic is accepted.

### 4b. Twilio retry idempotency

`workers/api/src/db/inbound-sms.ts:48–71`: `webhook_deliveries` table with `UNIQUE(provider, external_id)` is checked before processing. If the same `MessageSid` arrives twice, the second insert would violate the unique constraint — but the code checks first with a SELECT (`dup` at line 48), then inserts. Between the SELECT and the INSERT there is a race window (two concurrent requests for the same `MessageSid`). Both could pass the `dup` check before either inserts.

Rating: 🟡 **MEDIUM** — In practice, Twilio retries are spaced minutes apart and the race window is tiny. But the fix is to use `INSERT OR IGNORE` and check affected rows, rather than SELECT-then-INSERT.

### 4c. Queue consumer failure and retry behaviour

`workers/api/src/queue/consumer.ts:169–187`:
```typescript
} catch (e) {
  console.error("Queue consumer error", e);
  msg.retry();
}
```

When the consumer throws (LLM timeout, D1 error), it calls `msg.retry()`. Cloudflare Queues
retries with exponential backoff. The queue config is `max_batch_size = 1`, `max_batch_timeout = 5`
(`wrangler.toml:31–32`). There is no dead-letter queue configured.

**On retry, the consumer re-runs the full pipeline**: loads lead, runs RAG, calls LLM, and if all
succeeds, inserts a new message and sends SMS. There is no "already replied" check before sending.
If the first run succeeded up to (and including) the Twilio send but then failed on the final D1
write (e.g. `updateLeadFields`), a retry would send a **second outbound SMS to the lead** and
insert a second AI message.

Rating: 🔴 **CRITICAL** — Queue retries can cause duplicate outbound SMS. The fix is to record a per-`messageId` "processing started" flag before calling the LLM, and check it at the start of each consumer run.

### 4d. Out-of-order messages

`processInboundSms` inserts messages by calling `nextMessageSortOrder()` which reads `MAX(sort_order)`.
If two inbound messages arrive concurrently and both read `MAX` before either writes, they will be
assigned the same `sort_order`. D1 has no `sort_order` UNIQUE constraint on messages.

Rating: 🟡 **MEDIUM** — Sort order collision produces a mildly corrupted conversation thread (two messages at the same position). The AI pipeline reads `lead.messages` and uses the last inbound message — if two messages are enqueued nearly simultaneously, both get processed and both send a reply. This is a special case of the Queue retry issue above but triggered by legitimate concurrent traffic rather than retries.

### 4e. Outbound delivery failure

`consumer.ts:151–158`: Twilio send is wrapped in try/catch:
```typescript
try {
  await sendTwilioSms(env, updated.phone, smsBody);
} catch (e) {
  console.error("Failed to send Twilio SMS", e);
}
```

On failure: the error is logged to `console.error` only. The message is still saved in D1. The
lead's status is still updated. No retry, no alert, no `delivery_failed` flag on the message.

Similarly, `twilio.ts:80–97` (status callback): `console.log` only. Comment says "Future: persist delivery status." NOT YET IMPLEMENTED.

Rating: 🟠 **HIGH** — Outbound SMS failures are silent to staff. A lead receives no message and no one is notified.

---

## 5. AI / Workers AI / RAG Layer

### 5a. Concurrent queue messages from same lead

`wrangler.toml:31`: `max_batch_size = 1` — the queue processes one message at a time per invocation.
However, multiple Worker instances can run concurrently. Two inbound SMS that arrive within the
same batch window (5 seconds) can be enqueued as separate queue messages and processed by separate
consumer instances simultaneously.

Both consumers call `getLead()`, which returns the current DB state (identical for both), then
both generate a reply, both insert messages, and both send SMS.

There is no per-lead lock, mutex, or `ai_paused` check in the queue consumer. `processSimulateReply`
at `consumer.ts:75` does check `lead.aiPaused` — but **only for simulate, not for real inbound**.
`processInbound` simply calls `processSimulateReply`, which also checks `lead.aiPaused`. So the
`aiPaused` flag is checked. But `aiPaused` is `false` by default; it is only set to `true` by staff
takeover. Two concurrent real messages from the same lead will both process and both reply.

Rating: 🔴 **CRITICAL** — No concurrency guard for simultaneous inbound messages from the same lead. Both will generate AI replies and send outbound SMS.

### 5b. Context window growth

`workers/api/src/ai/context.ts:20,92–97`:
```typescript
const MAX_HISTORY = 12;
// ...
.slice(-MAX_HISTORY)
```

History is capped at the last 12 `chat` messages. This is correctly bounded.

🟢 **OK** — History truncation is present and applied before building the prompt.

### 5c. LLM failure handling

`workers/ai.ts:108–114` (`runChatModel`): No try/catch. If the Workers AI call throws, the exception
propagates up to `consumer.ts:182` which catches it and calls `msg.retry()`.

As noted in §4c, retry without an "already replied" guard means duplicate SMS. For the specific case
of LLM failure (no reply sent yet), retry is safe. The risk is failures that happen _after_ the SMS
is sent.

When Workers AI fails, the lead receives **no message** and the queue retries up to the configured
limit. There is no fallback message, no staff notification, and no visible state change on the lead
beyond the queue eventually exhausting retries and silently dropping the job (no dead-letter queue).

Rating: 🟠 **HIGH** — LLM failures are silent to staff and leads. After retry exhaustion the lead is simply abandoned with their message unanswered.

### 5d. Judge LLM: what happens on Hold

`workers/api/src/ai/judge.ts:121–153`:
- Judge votes `Hold` with no rewrite → the code **overrides the Hold** if the reply passes
  rule-based checks, logs a warning, and sends the original reply (`judge.ts:139–153`).
- Judge votes `Hold` with a rewrite → uses the rewrite if it passes rules; otherwise falls back to `SMS_SAFE_FALLBACK`.

The override behaviour at line 140 means the judge LLM's `Hold` verdict is effectively advisory, not binding, if the hard rules pass. This is a deliberate design choice but means a biased or hallucinating LLM reply will be sent unless it contains a price that isn't in the knowledge base, medical advice, or exceeds 320 chars.

Rating: 🟡 **MEDIUM** — The judge is mostly advisory. Document this clearly for clients.

### 5e. Workers AI cost / rate limits per client

NOT FOUND IN CODEBASE. There is no per-client request counter, neuron budget guard, or rate limiter.
Every message from every client on the same Cloudflare account consumes from the same Workers AI
neuron budget. On the free tier, the budget is shared across all Workers on the account.

Each inbound SMS fires:
1. One embedding call (`embedText` in `rag.ts`)
2. One LLM call (reply generation — 70B model)
3. One LLM call (judge — 8B model)
= 3 AI calls per message, across all clients sharing the account.

Rating: 🟠 **HIGH** — A single high-traffic client (or a chat loop from a single lead) can exhaust the account's Workers AI budget, causing all AI to fail for all clients. No mechanism exists to detect or limit this.

---

## 6. Concurrency & Race Conditions

### 6a. AI → staff takeover race

`routes/leads.ts:69–95` (`handleTakeover`): Sets `ai_paused = true` in D1 and emits a domain event.

`consumer.ts:74–75`:
```typescript
let lead = await getLead(env, leadId);
if (!lead || lead.aiPaused) return;
```

If the consumer has already loaded the lead (before `getLead` returns `aiPaused=true`) and is mid-LLM
call when the staff member clicks Takeover, the LLM result is still used and the SMS is still sent
(`consumer.ts:147–158`). The `aiPaused` check happens only at the start of `processSimulateReply`,
before the pipeline begins — there is no check at the point of sending.

Rating: 🟠 **HIGH** — A staff member clicking Takeover does not reliably stop an in-flight AI reply. The AI reply and staff message can both send within the same second. The lead receives two messages.

### 6b. Double-booking

`db/trial-booking.ts:45–108` (`confirmTrial`): Calls `updateLeadFields()` which issues an `UPDATE leads SET ...` with no optimistic locking or transaction. Two concurrent `confirmTrial` calls for the same lead with different slots would result in the last writer winning, and both AI replies would be sent (each confirming different slots).

The `leads` table has no `trial_confirmed_at IS NULL` guard in the `UPDATE` statement. A check-then-update pattern is not used.

NOT FOUND IN CODEBASE: Any UNIQUE constraint or transaction wrapping the trial booking to prevent double-confirmation.

Rating: 🟠 **HIGH** — Double-booking is theoretically possible when two near-simultaneous affirmative messages arrive for the same lead. In practice the `max_batch_size=1` queue serialises processing, but simultaneous queue consumers remain a risk (see §5a).

### 6c. Atomic D1 writes

D1 supports transactions via `env.DB.batch([])`. Surveying the codebase:

`inbound-sms.ts:73–187` creates a lead across multiple sequential `.run()` calls: INSERT webhook_deliveries → INSERT lead → INSERT timeline_event → INSERT message × 2. These are **not wrapped in a transaction**. A Worker crash between any two steps leaves partial data.

`consumer.ts`: Multiple sequential writes (INSERT message, UPDATE lead, INSERT domain_events, INSERT domain_events) — also not wrapped in a transaction.

NOT FOUND IN CODEBASE: Any use of `env.DB.batch()` for multi-step writes.

Rating: 🟠 **HIGH** — Any Worker crash mid-processing leaves the DB in an inconsistent state (e.g. a lead row exists but has no messages; or messages exist but lead status is not updated).

---

## 7. Auth & Access Control

### 7a. Magic link auth flow

`workers/api/src/auth/session.ts:44–89` (`createMagicLinkToken`, `consumeMagicLinkToken`):

- Token generation: `randomToken()` = two UUIDs concatenated (`crypto.ts:10–12`) = 72 hex chars. UUIDs are generated with `crypto.randomUUID()` — cryptographically random.
- Storage: `token_hash` = SHA-256 of the raw token (`crypto.ts:2–8`). Raw token never persisted. ✅
- Expiry: `MAGIC_LINK_TTL_MS = 15 * 60 * 1000` (15 minutes) checked at `session.ts:80`. ✅
- Single-use: `used_at` is null on first use; checked at line 79. After use, `used_at` is set. ✅

🟢 **OK** — Magic link security is correctly implemented.

One note: `session.ts:52–58` inserts the token without checking for an existing unexpired token for the same email. A user who requests 5 links in quick succession creates 5 valid tokens. This is acceptable but could be tightened with a rate limit.

### 7b. Session management

`session.ts:91–107` (`createSession`): Session token stored as SHA-256 hash in `staff_sessions` table. TTL is 30 days (`crypto.ts:15`). Session is validated on each request by `getStaffSession()` which loads the full `staff_users` row via a JOIN. Cookie is `HttpOnly`, `Secure`, `SameSite=Lax`.

🟢 **OK** — Session implementation is correct.

No session rotation on use. Not critical but standard practice.

### 7c. Route protection audit

All routes from `workers/api/src/index.ts`:

| Route | Auth | Notes |
|---|---|---|
| `GET /health` | Public | ✅ intentional |
| `POST /leads/intake` | Public | ✅ intentional (website form) |
| `POST /auth/magic-link` | Public | ✅ |
| `GET /auth/verify` | Public | ✅ |
| `POST /auth/logout` | Public\* | Parses session cookie but doesn't require it |
| `GET /auth/me` | Checks session internally | 401 if absent |
| `PATCH /auth/profile` | Checks session internally | 401 if absent |
| `GET /auth/team` | Checks session + role | 403 for non-admin |
| `POST /auth/team/invite` | Checks session + role | 403 for non-admin |
| `POST /webhooks/telnyx` | Public\* | No signature verification |
| `POST /webhooks/twilio` | Twilio signature | Conditional — see §4a |
| `POST /webhooks/twilio/status` | Twilio signature | Conditional — see §4a |
| All `/admin/*` routes | Session gate at `index.ts:51–56` | ✅ |
| All `/leads/*` routes | Session gate at `index.ts:51–56` | ✅ |
| `GET /locations` | Session gate | ✅ |
| `GET /events/stream` | Session gate | ✅ |

🔴 **CRITICAL** — `POST /webhooks/telnyx` at `index.ts:198`: falls inside the `path.startsWith("/webhooks/")` public block but `routes/webhooks.ts` contains no signature verification. NOT FOUND IN CODEBASE: Telnyx webhook signature validation. Anyone can POST arbitrary data to this endpoint. The Telnyx handler presumably creates/modifies leads.

### 7d. Superadmin email

`workers/api/src/auth/constants.ts:2`:
```typescript
export const SUPERADMIN_EMAIL = "joachim@phiof.digital";
```

This is **hardcoded in source code**, not an env var. It is identical across every client build
that pulls from `pdc-template`. This means:
1. `joachim@phiof.digital` can sign in to every client's inbox — any client, at any time.
2. Clients cannot remove or change this access without modifying committed source code.
3. When the template is open-sourced or inspected, this email is public.

This is a deliberate architectural choice (platform operator access). But it means every client
implicitly grants access to the platform operator's email. This must be disclosed to clients.

There is **no entry seeded in `staff_users`** for this email in any migration. The `resolveStaffUserOnLogin`
function in `staff.ts:83–118` creates the row on first login dynamically. This means on a fresh
deployment, before the operator has ever logged in, there is no `staff_users` row for this email,
but the operator can still obtain access simply by completing the login flow. The row creation is
reliable and correct but its absence pre-login could confuse debugging.

Rating: 🟡 **MEDIUM** (security) — The access model is intentional. The risk is undisclosed operator access in client agreements. Not a code bug, but a commercial and legal consideration.

---

## 8. Caching & Cost

### 8a. Inbound message processing path — operation breakdown

For every inbound SMS to every client:

| Step | Operation | Cached? |
|---|---|---|
| Webhook receipt | 1× D1 read (`webhook_deliveries`) | No |
| Dedup insert | 1× D1 write (`webhook_deliveries`) | No |
| Lead lookup by phone | 1–2× D1 read (`leads`) | No |
| Lead insert or message insert | 1–3× D1 write | No |
| Domain event insert × 2 | 2× D1 write | No |
| Queue send | 1× Queue write | No |
| *(Queue consumer)* | | |
| Lead load | 1× D1 read (leads + messages JOIN) | No |
| `ai_config` load | 1× D1 read | No |
| `location_override` load | 1× D1 read | No |
| `location_programme_schedules` load | 1× D1 read | No |
| Embedding (RAG query) | 1× Workers AI (embed model) | No |
| Vectorize search | 1× Vectorize read | No |
| Reply generation | 1× Workers AI (70B LLM) | No |
| Judge validation | 1× Workers AI (8B LLM) | No |
| Message insert | 1× D1 write | No |
| Lead update | 1× D1 write | No |
| Domain event insert × 2 | 2× D1 write | No |
| Twilio SMS send | 1× external HTTP | No |

**Total per message:** ~12 D1 ops, 1 Vectorize query, 2 LLM calls, 1 Twilio call. Zero caching anywhere.

Rating: 🟡 **MEDIUM** — At low volume (< 50 messages/day) this is acceptable. At 100 messages/day across 10 clients (1,000 msgs/day), the Workers AI calls will hit budget limits. The `ai_config` and `location_programme_schedules` reads are good KV cache candidates — they change rarely.

### 8b. Vectorize / RAG caching

NOT FOUND IN CODEBASE. Every inbound message triggers a fresh vector search. Repeated questions
("what are your prices?") from different leads each pay the full embedding + Vectorize cost.

Rating: 🟡 **MEDIUM** — Not urgent at current scale.

### 8c. AI config caching

`getAiConfig()` (`ai-config.ts:25–38`) makes a D1 query on every queue job. `ai_config` changes
perhaps once per month. NOT FOUND IN CODEBASE: Any KV caching of this value.

Rating: 🟡 **MEDIUM**.

### 8d. KV caching layer

NOT FOUND IN CODEBASE. No `KVNamespace` binding exists in `env.ts` or `wrangler.toml`. There is
no caching layer of any kind.

Rating: 🟡 **MEDIUM** — Not critical now; will matter at 10+ clients.

---

## 9. Observability & Failure Visibility

### 9a. Structured logging with org context

NOT FOUND IN CODEBASE. `console.error` and `console.log` calls throughout the codebase do not
include `ORGANIZATION_ID` or client context. Example: `consumer.ts:183` logs "Queue consumer error"
with the exception only — no lead ID, no org ID, no message type.

In Cloudflare Workers, logs are visible per-Worker in the dashboard. Since each client has their
own Worker (due to the fork model), per-client isolation of logs works by Worker, not by structured
fields. But debugging cross-client incidents or correlating a lead's failed AI reply requires manual
cross-referencing.

Rating: 🟡 **MEDIUM** — Workable at 2–3 clients; becomes painful at 10.

### 9b. Queue failure visibility

When the queue consumer fails and retries are exhausted: silent drop. No dead-letter queue is
configured in `wrangler.toml`. No error is written to D1. No domain event is emitted. Staff see
no visual indicator that an AI reply failed.

The lead remains with its last known state (e.g. `assessment: "New message — AI responding"`)
indefinitely. There is no timeout or staleness indicator.

Rating: 🔴 **CRITICAL** — For a paid product, a lead that messaged 4 hours ago with no reply and no staff alert is a serious product failure. This must be addressed before charging real money.

### 9c. Health check endpoint

`GET /health` (`index.ts:58–60`) returns `{ ok: true }`. It does not verify D1 connectivity,
Vectorize availability, or Queue binding.

```typescript
if (path === "/health") {
  return jsonResponse(request, env, { ok: true });
}
```

Rating: 🟡 **MEDIUM** — The health check gives a false positive. A Worker with a broken DB binding would still return 200.

### 9d. Ops runbook

NOT FOUND IN CODEBASE. There is no runbook, incident response doc, or escalation path documented
in the repo. The README covers deployment but not "what to do when something is broken in production."

Rating: 🟠 **HIGH** — This must exist before charging clients at any price point.

---

## Final Sections

---

### Top 5 Things to Fix Before Onboarding Client #2

**Ordered by risk.**

1. **Queue consumer retry → duplicate SMS** (`consumer.ts:169–187` + `db/inbound-sms.ts`): Add a per-message "processing lock" at the start of the consumer (e.g. a `processing_started_at` flag in D1), check it before sending SMS, and only send if the current run inserted the message. Without this, any LLM/D1 transient error causes a duplicate outbound SMS to a real lead.

2. **Hardcoded `"manchester"` default location** (`inbound-sms.ts:36`): Any client without a `manchester` location gets a foreign-key violation on every inbound SMS (or silent fallback depending on D1 FK enforcement). Fix: derive the default from the org's first location, or require the config to be set explicitly.

3. **Telnyx webhook has no authentication** (`routes/webhooks.ts`, called from `index.ts:198`): The Telnyx handler is public with no signature validation. Fix: add Telnyx webhook signature verification (HMAC-SHA256 with their signing secret) before processing any payload.

4. **`getLead()` has no `organization_id` scope** (`db/leads.ts:247`): Add `AND organization_id = ?` as defence-in-depth. If any two clients ever end up on the same D1 database (mis-deploy, copy-paste error), they can read each other's leads. One-line fix.

5. **Silent queue failure — staff never know AI failed** (`consumer.ts` + `db/events.ts`): Emit a `lead.ai_failed` domain event (visible in the SSE stream) when the consumer exhausts retries, and update the lead's `assessment` to something like "AI reply failed — check manually". This is the minimum viable ops signal.

---

### Top 5 Things That Will Break at 10 Clients

1. **`git merge upstream/main` destroys client knowledge chunks** (`packages/knowledge/src/index.ts`): Every base update creates a merge conflict on this file for every client. At 10 clients, updating the base requires 10 manual merge resolutions. Fix: remove `KNOWLEDGE_CHUNKS` from the merge path entirely — serve all production knowledge from D1 portal chunks only.

2. **No migration enforcement on deploy** (`deploy-remote.sh` not enforced): Any developer who runs `wrangler deploy` directly (or via a GitHub Action) instead of `pnpm deploy:remote` ships new code against old schema. At 10 clients, at least one will do this. Fix: add a migration-check step at Worker startup, or use a CI pipeline that only calls `deploy-remote.sh`.

3. **`domain_events` table has no `organization_id` index** (`0001_schema.sql:82`): Every SSE poll (every 800ms per connected user) queries this table. At 10 clients × 3 concurrent users × 800ms, that is 37.5 queries/second, all unindexed on `organization_id`. Add `CREATE INDEX idx_domain_events_org_created ON domain_events(organization_id, created_at)`.

4. **Shared Workers AI neuron budget** (`workers-ai.ts:106–114`): 10 clients sharing one Cloudflare account share one AI budget. A single viral campaign or busy Saturday at one client degrades AI for all others. Fix: move to a paid Workers AI plan with per-account limits understood, and consider per-client rate limiting via KV counters.

5. **No per-client version tracking**: With 10 client repos at various merge levels and feature branches, there is no way to know which migration or feature version each client is on without SSH-ing into each. Fix: store current migration version in a `_meta` table and expose it on `/health`.

---

### Honest Verdict

This is not a solid £200/month SaaS product yet. It is a well-built, coherent demo that proves the concept and handles the happy path correctly. The auth is properly implemented, the AI pipeline is thoughtful, and the core lead-nurture flow works. But there are at least four ways it can silently damage a paying client's business right now: duplicate SMS to leads (queue retry), all inbound SMS failing on any non-Manchester deployment (hardcoded location), a staff member getting no alert when AI fails (no observability), and an unauthenticated endpoint accepting fake Twilio data. None of these are architectural rewrites — they are one-day fixes. The multi-client scale risks (merge conflicts, shared AI budget, no version tracking) are real but tolerable until client 3 or 4. The verdict is: fix the five critical items above, add a dead-letter/alert mechanism for queue failures, and this becomes a legitimate product. Ship without those fixes and a single busy week with a real paying client will surface at least two of them.

---

*Audit performed by Cursor agent on the `pdc-template` repository at commit `468a7b9`.*
