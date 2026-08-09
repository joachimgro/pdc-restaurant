# C1 — Live SMS STOP proof (pdc-restaurant)

## Secret (set yourself — do not paste into chat)

| Name | Where |
|------|--------|
| `TELNYX_WEBHOOK_PUBLIC_KEY` | Cloudflare Worker **`pdc-restaurant`** secrets |

```bash
cd workers/api
npx wrangler secret put TELNYX_WEBHOOK_PUBLIC_KEY
# paste the Telnyx Messaging webhook Ed25519 public key from Telnyx portal
```

Also confirm in Telnyx portal that the messaging webhook URL is:

`https://api.kitchen.phiof.digital/webhooks/telnyx`

## Live evidence that verification is armed (2026-08-09)

- `wrangler secret list` includes `TELNYX_WEBHOOK_PUBLIC_KEY`
- Unsigned `POST /webhooks/telnyx` → **403** `Invalid signature` (not 500 “not configured”)
- `/health` `config_gate` fails closed if SMS is on and this secret is missing

## After you text STOP to the booking From-number

1. **Table:** `sms_suppressions`
2. **Fields:** `organization_id='restaurant'`, `phone_e164` = your number in E.164 (`+44…`), `source='stop'`
3. **Health:** after a due SMS is processed, `notificationQueue.skippedByReason.suppressed` ≥ 1 (and `checks.notification_queue.details` contains `suppressed`)

Ops can confirm with:

```bash
npx wrangler d1 execute pdc-restaurant-db --remote --command \
  "SELECT phone_e164, source, suppressed_at FROM sms_suppressions ORDER BY suppressed_at DESC LIMIT 5;"
```

## Due SMS skip after STOP

Seed or wait for a due `reservation_reminder_sms` to that E.164. After the next cron (`*/5`):

```bash
npx wrangler d1 execute pdc-restaurant-db --remote --command \
  "SELECT id, status, error_text, provider_message_id, to_address
   FROM notifications
   WHERE channel='sms' AND to_address='+44YOURNUMBER'
   ORDER BY updated_at DESC LIMIT 5;"
```

**Correct:** `status='skipped'`, `error_text='sms_suppressed'`, `provider_message_id` NULL.

## After you text START or UNSTOP

Same `sms_suppressions` row for that `phone_e164` must be **gone**. A new due SMS may send (`status='sent'`, provider id set).

## GATE

Real phone → real STOP → row in `sms_suppressions` → due SMS skipped with `sms_suppressed`. Nothing less.
