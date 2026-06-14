# Twilio setup

## Messaging Service (recommended)

1. Twilio Console → Messaging → your **Messaging Service**
2. **Integration → Incoming Messages** → **Send a webhook**
   - URL: `https://pdc-{client-slug}.<your-subdomain>.workers.dev/webhooks/twilio`
   - HTTP POST
3. **Delivery status callback** (optional)
   - URL: `https://pdc-{client-slug}.<your-subdomain>.workers.dev/webhooks/twilio/status`

Do **not** use “Receive the message” (API only) — that never calls your Worker.

## Worker secrets (not Next.js `.env`)

Twilio credentials must be on the **Cloudflare Worker**, not `apps/web/.env.local` or the repo root `.env`.

```bash
cd workers/api

wrangler secret put TWILIO_ACCOUNT_SID   # ACxxxxxxxx (Account SID on Console home)
wrangler secret put TWILIO_AUTH_TOKEN    # primary Auth Token — NOT an API Key SID
wrangler secret put TWILIO_MESSAGING_SERVICE_SID  # MGxxxxxxxx

pnpm deploy
```

### Common mistake → error 20003 Authenticate

| Wrong | Right |
|-------|--------|
| API Key SID (`SK…`) in `TWILIO_ACCOUNT_SID` | Account SID (`AC…`) |
| API Key Secret in `TWILIO_AUTH_TOKEN` | Primary **Auth Token**, or use API keys below |
| Values only in `.env` / `.env.local` | `wrangler secret put` on `workers/api` |

Optional API Key auth (instead of primary Auth Token):

```bash
wrangler secret put TWILIO_API_KEY_SID      # SK…
wrangler secret put TWILIO_API_KEY_SECRET
# TWILIO_ACCOUNT_SID must still be AC…
```

### Verify without sending SMS

```bash
curl -s https://pdc-{client-slug}.<your-subdomain>.workers.dev/admin/twilio-check | jq
```

`ok: true` means Twilio accepts your credentials. `ok: false` with `hints` explains what to fix.

Compare `diagnostics.accountSidMask` (e.g. `ACda99…abcd`) with the Account SID on [console.twilio.com](https://console.twilio.com) — they must be the **same account** as the Auth Token.

### Test credentials on your Mac before `wrangler secret put`

Replace with values from **the same** Twilio account page:

```bash
ACCOUNT_SID="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
AUTH_TOKEN="paste_primary_auth_token_here"

curl -s -w "\nHTTP %{http_code}\n" -u "$ACCOUNT_SID:$AUTH_TOKEN" \
  "https://api.twilio.com/2010-04-01/Accounts/$ACCOUNT_SID.json"
```

- **HTTP 200** + JSON with `friendly_name` → pair is correct; use those exact strings in wrangler.
- **HTTP 401** → wrong token or wrong account; fix in Console first (rotate Auth Token or create an API Key).

Then push to the Worker (no redeploy needed after secrets):

```bash
cd workers/api
printf '%s' "$ACCOUNT_SID" | wrangler secret put TWILIO_ACCOUNT_SID
printf '%s' "$AUTH_TOKEN" | wrangler secret put TWILIO_AUTH_TOKEN
```

Using `printf '%s'` avoids accidentally adding a newline to the secret.

### Prefer API Key (often fewer mix-ups)

1. Console → **Account** → **API keys & tokens** → **Create API key**
2. Copy **SID** (`SK…`) and **Secret** (shown once)

```bash
cd workers/api
wrangler secret put TWILIO_ACCOUNT_SID    # AC… (same account as the key)
wrangler secret put TWILIO_API_KEY_SID    # SK…
wrangler secret put TWILIO_API_KEY_SECRET
```

You can leave `TWILIO_AUTH_TOKEN` unset when using API keys.

### Inbox-only demo (no outbound texts)

In `wrangler.toml` under `[vars]`:

```toml
TWILIO_SEND_OUTBOUND = "false"
```

AI replies still appear in the dashboard; SMS is skipped.

## Flow

```
Inbound SMS → POST /webhooks/twilio (validate signature, <200ms)
           → D1 lead + message
           → Queue AI
           → AI reply saved + SSE to dashboard
           → Twilio REST API sends SMS to customer
```

## Local dev

Copy `.dev.vars.example` → `.dev.vars` with your credentials.

`wrangler dev` webhook URL: use `wrangler dev --remote` or ngrok → your tunnel + `/webhooks/twilio`.

For quick local tests without signature: `TWILIO_SKIP_SIGNATURE_VALIDATION=true` in `.dev.vars` only.

## Test inbound (after deploy)

Text your Twilio number from your phone. Watch:

- `wrangler tail` for logs
- `/inbox` for the new thread + AI reply
