# C6 — Live erase / export / retention proof

Use the **live** API: `https://api.kitchen.phiof.digital`  
Auth: header `X-Admin-Secret: <value of ADMIN_SEED_SECRET>`  

**You must set the secret yourself** (it is not currently on the Worker):

```bash
cd workers/api
npx wrangler secret put ADMIN_SEED_SECRET
```

Do not paste the secret into chat. After each step, keep the JSON responses as evidence.

## 1) Seed a disposable guest (D1)

Pick a unique email/phone you control, e.g. `erase-proof+$(date +%s)@example.com` and `+4477009XXXXX`.

```bash
EMAIL='erase-proof@example.com'
PHONE='+447700900999'
RID=$(uuidgen | tr '[:upper:]' '[:lower:]')
NID=$(uuidgen | tr '[:upper:]' '[:lower:]')
CID=$(uuidgen | tr '[:upper:]' '[:lower:]')

npx wrangler d1 execute pdc-restaurant-db --remote --command "
INSERT INTO contacts (id, organization_id, name, phone_e164, email)
VALUES ('$CID', 'restaurant', 'Erase Proof', '$PHONE', '$EMAIL');
INSERT INTO contact_identifiers (id, contact_id, organization_id, type, value, is_primary)
VALUES ('$(uuidgen)', '$CID', 'restaurant', 'email', '$EMAIL', 1);
INSERT INTO contact_identifiers (id, contact_id, organization_id, type, value, is_primary)
VALUES ('$(uuidgen)', '$CID', 'restaurant', 'phone', '$PHONE', 1);
INSERT INTO guest_profiles (contact_id, organization_id, allergies, notes, visit_count, no_show_count)
VALUES ('$CID', 'restaurant', 'nuts', 'secret note', 2, 1);
INSERT INTO reservations (
  id, organization_id, location_id, reference, contact_id, guest_name, guest_phone, guest_email,
  party_size, service_date, start_time, end_time, starts_at_utc, status, source,
  assignment_locked, deposit_required_pence, marketing_opt_in, allergies, guest_notes
) VALUES (
  '$RID', 'restaurant', 'venue-main', 'ERASE1', '$CID', 'Erase Proof', '$PHONE', '$EMAIL',
  2, '2026-08-20', '19:00', '20:30', '2026-08-20T18:00:00.000Z', 'finished', 'online',
  0, 0, 0, 'nuts', 'guest note'
);
INSERT INTO notifications (
  id, organization_id, location_id, reservation_id, channel, template,
  to_address, status, scheduled_for, attempts, idempotency_key
) VALUES (
  '$NID', 'restaurant', 'venue-main', '$RID', 'email', 'reservation_confirmed',
  '$EMAIL', 'sent', datetime('now'), 1, 'erase-proof-$NID'
);
"
```

## 2) Export (before erase)

```bash
curl -sS "https://api.kitchen.phiof.digital/service/guests/export?email=$EMAIL" \
  -H "X-Admin-Secret: $ADMIN_SEED_SECRET" | tee /tmp/guest-export-before.json
```

**Correct:** JSON includes that reservation, notification `to_address`, profile allergies/notes. No other guests’ emails.

## 3) Erase

```bash
curl -sS -X POST https://api.kitchen.phiof.digital/service/guests/erase \
  -H "content-type: application/json" \
  -H "X-Admin-Secret: $ADMIN_SEED_SECRET" \
  -d "{\"email\":\"$EMAIL\"}" | tee /tmp/guest-erase.json
```

**Correct:** `{ "ok": true, "result": { …counts… } }`.

Spot-check D1:

```bash
npx wrangler d1 execute pdc-restaurant-db --remote --command "
SELECT guest_name, guest_email, guest_phone, allergies, guest_notes FROM reservations WHERE id='$RID';
SELECT to_address FROM notifications WHERE id='$NID';
SELECT name, email, phone_e164 FROM contacts WHERE id='$CID';
SELECT allergies, notes FROM guest_profiles WHERE contact_id='$CID';
"
```

**Correct:** name `Former guest`; email/phone/allergies/notes cleared or anonymised markers; notification address anonymised.

## 4) Export after erase

```bash
curl -sS "https://api.kitchen.phiof.digital/service/guests/export?email=$EMAIL" \
  -H "X-Admin-Secret: $ADMIN_SEED_SECRET" | tee /tmp/guest-export-after.json
```

**Correct:** no live PII for that email (empty or anonymised only).

## 5) Retention cron is registered

Cron dispatcher step `retentionAnonymisation` runs every `*/5` (same Worker schedule). Evidence in code: `workers/api/src/cron/dispatcher.ts`. Live evidence of cron ticking: `/health` → `checks.cron_heartbeat.last_ok=…`.

To prove anonymisation preserves aggregates without waiting 24 months, use the erase path above (same wipe function) **or** temporarily set `retention_months=1` on a finished booking older than 1 month, wait one cron tick, then confirm `queryServiceStats` / covers still count while name is `Former guest`.

**Correct after retention wipe:** party size / status / service date remain; guest name/email/phone gone.
