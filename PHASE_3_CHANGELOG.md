# Phase 3 — Concurrency & Data Integrity

Scoped fixes for the concurrency / data-integrity findings in the pre-scale
audit. Every fix operates at the **lead** and **message** level so it is
channel-agnostic: Twilio today, Telnyx next, then Facebook Messenger /
Instagram / WhatsApp — all inherit these protections by going through the same
code paths (queue consumer entry point + shared DB utilities).

All typechecks pass (`shared-types`, `workers/api`, `apps/web`).

---

## Migrations

### `workers/api/migrations/0018_lead_processing_locks.sql` (new)
- Adds `lead_processing_locks (lead_id PK, locked_at, locked_by_queue_message_id, expires_at)` + `idx_lead_locks_expires`.
- **Why:** lead-level serialisation lock for AI processing (Fix 1). `expires_at` gives a 2-minute TTL so a crashed consumer can't permanently wedge a lead.
- **Audit finding:** §5a (duplicate AI replies under concurrent inbound messages).

Sequentially numbered after Phase 2's highest (`0017`).

---

## Fix 1 — Per-lead concurrency lock for AI processing (§5a)

### `workers/api/src/queue/consumer.ts`
- Added `acquireLeadLock()` / `releaseLeadLock()` helpers and `LEAD_LOCK_TTL_MS = 2 min`.
- `acquireLeadLock` does `INSERT ... ON CONFLICT(lead_id) DO UPDATE ... WHERE expires_at < datetime('now')` then re-reads `locked_by_queue_message_id` to confirm ownership. Only an *expired* lock is ever overwritten, so an active holder is never displaced.
- In `handleQueueBatch`, after the Phase 1 `queue_processing_locks` check, the consumer acquires the lead lock. If another consumer holds it, it backs off with `msg.retry({ delaySeconds: 5 })` and `continue`s (the two messages are serialised, not dropped).
- Lock is released in a `finally` block on every terminal path (success or final failure). Release is guarded by `locked_by_queue_message_id` so a consumer never releases a lock it no longer owns.
- **Channel-agnostic:** keyed on `lead_id`. Any channel plugin that enqueues to `AI_QUEUE` is serialised automatically — no per-channel work required.

---

## Fix 2 — AI → staff takeover race condition (§6a)

### `workers/api/src/queue/consumer.ts`
- In `processSimulateReply`, immediately before the outbound send, the consumer re-reads `ai_paused` for the lead (`SELECT ai_paused FROM leads WHERE id = ? AND organization_id = ?`).
- If staff took over mid-pipeline (`ai_paused = 1`), the consumer aborts: it emits a `lead.ai_aborted` domain event and returns **without writing the AI message to D1** (an unsent message in history confuses staff and corrupts LLM context on future turns).
- The send is the only irreversible step, so the message write + lead update + events were moved to *after* the send (see Fix 4, Group B), making the discard clean.
- **Channel-agnostic:** `ai_paused` lives on the `lead` row, not on a channel-specific record.

### `packages/shared-types/src/events.ts`
- Added `lead.ai_aborted` event type + `LeadAiAbortedEventSchema` (`{ leadId, reason }`).

### `apps/web/src/store/inbox-store.ts`
- `applyEvent` now refreshes the lead on `lead.ai_aborted` (and `lead.sync_failure`).

---

## Fix 3 — Trial double-booking guard (§6b)

### `workers/api/src/db/trial-booking.ts`
- `confirmTrial` now returns `ConfirmTrialResult { confirmed, alreadyConfirmed, existingSlotLabel? }` (was `void`).
- The confirmation UPDATE is now guarded: `... WHERE id = ? AND organization_id = ? AND trial_confirmed_at IS NULL`. The result's `meta.changes === 0` means the trial was already confirmed by an earlier write — we log a warning and return `alreadyConfirmed: true` without writing the timeline event or emitting a duplicate `lead.updated`.

### `workers/api/src/ai/run-booking-flow.ts` & `workers/api/src/ai/pipeline.ts`
- All 7 `confirmTrial` call sites now capture the result. When `alreadyConfirmed` is true, the outbound reply is marked `skipSms = true` so the lead does **not** receive a second "you're booked" SMS.
- `workers/api/src/db/trial-slot.ts` (legacy alias) is unaffected — it ignores the new return value.

---

## Fix 4 — Atomic D1 writes for multi-step operations (§6c)

### `workers/api/src/db/leads.ts`
- Added `buildMessageStatements()` — returns the prepared INSERT statement(s) for a message (chat messages with reasoning produce two) without running them, plus the generated id.
- Added `buildLeadUpdateStatement()` + exported `LeadFieldUpdates` type — returns the dynamic lead UPDATE statement without running it.
- `insertMessage()` and `updateLeadFields()` were refactored to delegate to the new builders (behaviour unchanged for existing callers).

### `workers/api/src/db/events.ts`
- Added `domainEventStatement()` — builds the `domain_events` INSERT statement (with the same id/createdAt/payload serialisation) without running it, so events can be included in a batch. `insertDomainEvent()` now delegates to it.

### `workers/api/src/db/inbound-sms.ts`
- **Group A (atomic):** the inbound message write is now a single `env.DB.batch([...])`:
  - *Existing lead:* `[optional day divider, inbound chat message, lead UPDATE, message.created event, lead.updated event]`.
  - *New lead (we won the race):* `[timeline_event, day divider, inbound chat message]`. The lead row INSERT itself stays a standalone commit because Phase 2's `INSERT OR IGNORE` + winner re-check needs the row visible before attaching messages (FK).
  - *New lead (lost the race):* `[inbound chat message, lead UPDATE]` routed to the winner.
- If a batch fails, the webhook delivery row is deleted (and, on the new-lead path, the orphan lead row too) so the provider's retry re-processes cleanly — the message is never silently lost.

### `workers/api/src/queue/consumer.ts`
- **Group B (atomic):** after a successful send, the AI reply message + lead UPDATE + `message.created` + `lead.updated` events are written in a single `env.DB.batch([...])`.
- If that post-send batch fails (SMS already delivered, D1 didn't record it), it logs `CRITICAL ... Manual reconciliation needed` and emits a visible `lead.sync_failure` event. On the no-send path a batch failure rethrows so the queue retries.
- `queue_processing_locks` / `lead_processing_locks` writes are intentionally **outside** these batches — they're operational state and need their own commit points to be visible to other consumers.

### `packages/shared-types/src/events.ts`
- Added `lead.sync_failure` event type + `LeadSyncFailureEventSchema` (`{ leadId, error, phase }`).

---

## Fix 5 — webhook_deliveries dedup race condition (§4b)

### `workers/api/src/db/webhook-deliveries.ts` (new — shared utility)
- `recordWebhookDelivery(env, provider, externalId): { isDuplicate }` — `INSERT OR IGNORE INTO webhook_deliveries ...` then checks `meta.changes`. The `UNIQUE(provider, external_id)` constraint handles concurrent duplicates atomically; the previous SELECT-then-INSERT race is gone.
- `deleteWebhookDelivery(...)` — used to un-record a delivery when domain writes fail afterwards (self-heal on provider retry).

### `workers/api/src/db/inbound-sms.ts`
- Replaced the SELECT-then-INSERT dedup with a single `recordWebhookDelivery` call. On a duplicate it logs and returns `skipped`, so the webhook handler responds **200** (Twilio/Telnyx stop retrying — returning 4xx would cause a retry storm).
- `provider` is the channel identifier (`"twilio"`, `"telnyx"`, and later `"meta_instagram"`, `"meta_whatsapp"`, …).

---

## Verification checklist

- [x] Fix 1: `lead_processing_locks` table exists with TTL-based expiry.
- [x] Fix 1: consumer acquires lock before pipeline, releases in `finally`.
- [x] Fix 1: concurrent processing of same lead is serialised (second backs off with `retry({ delaySeconds: 5 })`).
- [x] Fix 2: consumer re-checks `ai_paused` immediately before send.
- [x] Fix 2: AI message is NOT written to D1 when abort-on-takeover triggers.
- [x] Fix 2: `lead.ai_aborted` event fires on takeover-mid-pipeline.
- [x] Fix 3: trial UPDATE includes `AND trial_confirmed_at IS NULL` guard.
- [x] Fix 3: callers handle `alreadyConfirmed` (no duplicate "you're booked" SMS).
- [x] Fix 4: inbound handler uses `env.DB.batch()` for the message/lead/event group.
- [x] Fix 4: queue consumer uses `env.DB.batch()` for the post-send write group.
- [x] Fix 4: post-send batch failure emits a visible `lead.sync_failure` event.
- [x] Fix 5: dedup uses `INSERT OR IGNORE` with `meta.changes` check.
- [x] Fix 5: duplicate webhook returns 200 (not 4xx).
- [x] Fix 5: dedup logic is in a shared utility callable by future channel plugins.
- [x] New migration numbered sequentially after Phase 2 (`0018`).

---

## Channel-agnostic patterns established

Future channel plugins (Telnyx, Facebook Messenger, Instagram, WhatsApp) inherit
all Phase 3 protections by reusing these entry points and utilities — no
per-channel concurrency code required:

1. **`recordWebhookDelivery(env, provider, externalId)`** (`db/webhook-deliveries.ts`)
   — the single idempotency gate. Every channel handler calls this first with its
   own `provider` string and returns 200 on `{ isDuplicate: true }`.

2. **`processInboundSms(...)` → `env.AI_QUEUE`** — the channel-neutral inbound
   path. It performs the atomic Group A write and enqueues AI processing. New
   channels should funnel inbound messages through this same function (see the
   "Known limitations" note about its name) so they get the unique-phone race
   handling and atomic writes for free.

3. **`handleQueueBatch` / `acquireLeadLock` / `releaseLeadLock`** (`queue/consumer.ts`)
   — the single AI-processing entry point. The per-lead lock is keyed on
   `lead_id`, so a lead messaging on SMS *and* Instagram simultaneously is
   serialised into one AI reply per turn. Any plugin that enqueues to `AI_QUEUE`
   is automatically serialised.

4. **Statement builders** (`buildMessageStatements`, `buildLeadUpdateStatement`,
   `domainEventStatement`) — reusable building blocks for assembling new
   atomic `env.DB.batch([...])` groups in any future handler.

5. **`ai_paused` re-check before send** — the takeover guard reads a lead-level
   column, so it protects outbound replies on any channel.

---

## Known limitations / follow-ups (not fixed this session)

- **`db/inbound-sms.ts` is SMS-named but channel-neutral in behaviour.** It
  already takes a `provider` field and handles Twilio + Telnyx. It should be
  renamed to `db/inbound-message.ts` (and `InboundSmsInput`/`processInboundSms`
  generalised) when the first non-SMS channel lands. Deferred to avoid an
  unrelated rename in this scoped session.

- **Lock contention vs. `max_retries`.** The lead-lock back-off uses
  `retry({ delaySeconds: 5 })`, which counts against the queue's `max_retries`
  (3, set in Phase 1). With a 2-minute lock TTL and ~5s of real processing this
  is comfortable, but a pathologically slow LLM turn (>15s) could push a
  contending second message toward the DLQ. If real traffic shows this, raise
  `max_retries` for the AI queue or move lock back-off to a dedicated
  delayed-retry path that doesn't consume the failure budget.

- **New-lead row is committed before its initial messages.** Phase 2's
  unique-phone race handling requires the lead row to be visible before
  attaching messages, so the lead INSERT is a separate commit from the Group A
  batch. A crash in the narrow window between them is self-healed by deleting
  the orphan lead + webhook delivery on batch failure, but a hard worker kill
  mid-batch could still leave a lead with no messages until the next inbound.
  Acceptable for now; revisit if it ever surfaces.

- **Booking-flow writes inside `generateAiReply` are not part of the takeover
  abort.** Fix 2 discards the AI *reply message*, but a `confirmTrial`/
  `proposeTrial` that ran earlier in the pipeline has already committed. The
  Fix 1 lead lock makes a concurrent takeover-mid-pipeline rare; full rollback
  of in-pipeline booking writes on abort is out of scope here.
