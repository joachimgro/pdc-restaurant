# Phase 1 Changelog — Critical Bugs Fixed

Fixes the four bugs identified in the pre-scale audit as most likely to damage a paying
client's business: duplicate SMS on queue retry, unauthenticated Telnyx webhook, silently
dropped AI failures, and a Twilio auth bypass.

---

## Fix 1 — Queue consumer retry sends duplicate SMS

**Audit finding:** §4c — `consumer.ts` retries the full pipeline (including SMS send) with no
idempotency guard. If the consumer succeeds through SMS send but fails on the final D1 write,
the lead receives two AI replies.

### Files changed

#### `workers/api/migrations/0016_queue_processing_locks.sql` (new)
Creates `queue_processing_locks` table:
- `queue_message_id TEXT PRIMARY KEY` — Cloudflare Queue message ID
- `lead_id TEXT NOT NULL`
- `sms_sent_at TEXT` — set immediately before the SMS provider call
- `created_at TEXT`

TODO: periodic cleanup job to `DELETE WHERE created_at < datetime('now', '-1 day')`.

#### `workers/api/src/queue/consumer.ts`
- `checkSendLock()` / `insertSendLock()` / `markSmsSent()` helpers operate on the lock table.
- At the start of each message in `handleQueueBatch`: checks for an existing lock row.
  - If `sms_sent_at IS NOT NULL` → SMS was already sent; ack and skip immediately.
  - If no row → insert one before processing begins.
- `markSmsSent()` is called **before** `sendTwilioSms()`. Intentional: worst case on failure
  is the lead doesn't get a reply (visible to staff, recoverable) not a duplicate.
- `queueMsgId` is threaded through `processInbound` → `processSimulateReply` to reach the
  lock call site next to the SMS send.

---

## Fix 2 — Telnyx webhook has no authentication

**Audit finding:** §4b — `routes/webhooks.ts` accepted POST requests with zero auth. Anyone
who discovered the URL could inject fake leads, trigger AI processing, and send real outbound
SMS to arbitrary numbers.

### Files changed

#### `workers/api/src/auth/telnyx-verify.ts` (new)
Ed25519 webhook signature verification using the Web Crypto API (`crypto.subtle`):
- Reads `telnyx-signature-ed25519` and `telnyx-timestamp` headers.
- Rejects payloads older than 5 minutes (replay protection).
- Signs `${timestamp}|${body}` and verifies against the base64-encoded public key.

#### `workers/api/src/env.ts`
Added `TELNYX_WEBHOOK_PUBLIC_KEY?: string` with a comment pointing to the Telnyx portal.

#### `workers/api/src/routes/webhooks.ts`
- Rejects with **500** when `TELNYX_WEBHOOK_PUBLIC_KEY` is not configured (unlike the old Twilio
  pattern of silent pass-through).
- Rejects with **403** when the Ed25519 signature is invalid.
- Uses `request.clone()` inside `verifyTelnyxWebhook` so the body is still readable for JSON parse.

#### `workers/api/.dev.vars.example`
Added `TELNYX_WEBHOOK_PUBLIC_KEY` (commented out) with instructions for finding it in the portal.

---

## Fix 3 — Silent queue failure (lead ghosted with no one knowing)

**Audit finding:** §4d — exhausted queue messages were silently dropped. Staff had no way to
know AI processing had permanently failed. Lead sat forever with "New message — AI responding".

### Files changed

#### `packages/shared-types/src/events.ts`
Added `"lead.ai_failed"` to `DomainEventTypeSchema` and a new `LeadAiFailedEventSchema`:
```typescript
payload: { leadId, error, attempts, queueMessageId? }
```
The SSE stream now carries this event type to connected inbox clients.

#### `workers/api/src/queue/consumer.ts`
- `handleQueueBatch` reads `msg.attempts` to distinguish final vs non-final retries.
- `MAX_ATTEMPTS = 3` constant (matches `max_retries` in `wrangler.toml`).
- On final attempt (`attempts >= MAX_ATTEMPTS`):
  - Updates lead `assessment` to `"⚠️ AI reply failed — needs manual response"`.
  - Emits `lead.ai_failed` domain event (picked up by SSE → inbox).
  - Acks the message (no further retries).
- On non-final failure: logs a warning and retries as before.

#### `workers/api/wrangler.toml`
Added `max_retries = 3` and `dead_letter_queue = "pdc-CHANGE_ME-dlq"` to the consumer config.
The DLQ preserves failed messages for inspection in the Cloudflare dashboard rather than
silently dropping them.

#### `scripts/deploy-remote.sh`
- Added `DLQ_NAME` variable parsed from `wrangler.toml`.
- Runs `wrangler queues create "$DLQ_NAME"` during deploy (safe to re-run).
- Added step 6 to post-deploy instructions: set `TELNYX_WEBHOOK_PUBLIC_KEY`.

#### `apps/web/src/store/inbox-store.ts`
`applyEvent` now handles `lead.ai_failed` by refreshing the lead — the updated `assessment`
field ("⚠️ AI reply failed — needs manual response") renders in the inbox immediately.

---

## Fix 4 — Twilio webhook auth is conditional (silent pass-through when token missing)

**Audit finding:** §4a — missing `TWILIO_AUTH_TOKEN` logged a warning and passed the request
through. A mis-deploy without the secret would accept every inbound webhook unauthenticated.

### Files changed

#### `workers/api/src/routes/twilio.ts`
Restructured `readAndVerifyTwilio` to enforce three exclusive paths:
1. `TWILIO_SKIP_SIGNATURE_VALIDATION=true` → skip (local dev only, logs a clear warning).
2. `TWILIO_AUTH_TOKEN` set → verify signature; reject 403 if invalid.
3. Neither set → **reject 500** (was: log warning and pass through).

The `handleTwilioStatus` delivery-status callback uses the same `readAndVerifyTwilio` helper
and inherits the same enforcement.

#### `workers/api/.dev.vars.example`
- Added `TWILIO_SKIP_SIGNATURE_VALIDATION=true` as the active default for local dev.
- Commented out `TWILIO_AUTH_TOKEN` with clear instructions to use `wrangler secret put`
  in production (never put the real token in `.dev.vars`).

---

## Verification results

| Check | Status |
|---|---|
| Migration 0016 applies cleanly (SQLite + all prior) | ✓ |
| `queue_processing_locks` table created | ✓ |
| `tsc --noEmit` (worker) | ✓ |
| `tsc --noEmit` (web app) | ✓ |
| `TWILIO_SKIP_SIGNATURE_VALIDATION` only in `twilio.ts` handler | ✓ |
| No `manchester` / `bolton` hardcoded in `workers/api/src/` | ✓ |
| `lead.ai_failed` in `DomainEventTypeSchema` and inbox store | ✓ |
| Telnyx handler rejects 500 when key unset | ✓ |
| Telnyx handler rejects 403 on bad signature | ✓ |
| Twilio handler rejects 500 when token unset and skip flag absent | ✓ |

---

## New secrets/config required per client

Every new client deployment now requires these additional secrets and config:

| Value | How to set | Required for |
|---|---|---|
| `TELNYX_WEBHOOK_PUBLIC_KEY` | `wrangler secret put TELNYX_WEBHOOK_PUBLIC_KEY` | Telnyx webhook auth (Fix 2) |
| `TWILIO_AUTH_TOKEN` | `wrangler secret put TWILIO_AUTH_TOKEN` | Twilio webhook auth (Fix 4 — was already required but now mandatory) |
| `dead_letter_queue` in `wrangler.toml` | Set `pdc-{slug}-dlq`; created by deploy script | DLQ for failed queue messages (Fix 3) |

Local dev escape hatch (never in production):
```
TWILIO_SKIP_SIGNATURE_VALIDATION=true   # in .dev.vars
```
