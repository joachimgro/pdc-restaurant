# Phase 3 Follow-up Changelog

Two scoped fixes from the Phase 3 verification pass.

---

## 1. Move `ai_paused` re-check immediately before send

### `workers/api/src/queue/consumer.ts`

**What changed:** The Fix 2 `ai_paused` re-check (SELECT + `lead.ai_aborted` abort branch) was moved from before the Group B statement-building block to inside the `if (willSend)` block, directly above `await sendTwilioSms(...)`.

**New order in `processSimulateReply`:**

1. Build `groupB` statements in memory (no DB writes).
2. `if (willSend)` → enter send `try` block.
3. Re-read `ai_paused`; on takeover → emit `lead.ai_aborted` and `return` (no message write, no send, no `markSmsSent`).
4. `await markSmsSent(...)` — only runs when send will proceed.
5. `await sendTwilioSms(...)` — immediately after the re-check passes.
6. `await env.DB.batch(groupB)` — post-send domain writes.

**Why:** The previous placement left ~58 lines of synchronous `groupB` construction between the re-check and the send. The re-check now sits at the last possible moment before the irreversible outbound step, while still allowing cheap in-memory statement building earlier (discarded for free on abort).

---

## 2. Resolve `trial-slot.ts` / `saveLeadTrialSlot`

### Option applied: **Delete the function entirely** (zero callers)

### Evidence

**Usage trace for `saveLeadTrialSlot`:**

| Search | Result |
|--------|--------|
| `grep -rn "saveLeadTrialSlot" workers/api/src/` (and full repo) | Only definition at `workers/api/src/db/trial-slot.ts:5` — **no callers** |
| `grep -rn "trial-slot" workers/api/src/` | No imports of `./trial-slot` or `db/trial-slot` anywhere in the codebase |

**Callers:** none.

**SMS path analysis:** N/A — the function is never invoked. No code path reaches `confirmTrial()` through this legacy alias, so it cannot trigger duplicate trial-confirmation SMS.

### `workers/api/src/db/trial-slot.ts` (deleted)

Removed the entire file. It contained a single exported function:

```typescript
export async function saveLeadTrialSlot(env, leadId, slot) {
  await confirmTrial(env, leadId, proposal);
}
```

This was a thin wrapper around `confirmTrial` from `trial-booking.ts`. All active booking flows call `confirmTrial` directly (`ai/run-booking-flow.ts` ×4, `ai/pipeline.ts` ×3) and already handle `alreadyConfirmed` → `skipSms`. The legacy alias was dead code.

**No import removals required** — nothing imported from `trial-slot.ts`.

---

## Verification

```bash
# Re-check is now adjacent to send (markSmsSent is the only line between on the happy path)
grep -n "ai_paused\|markSmsSent\|sendTwilioSms" workers/api/src/queue/consumer.ts

# saveLeadTrialSlot has no remaining references
grep -rn "saveLeadTrialSlot\|trial-slot" workers/api/src/
```
