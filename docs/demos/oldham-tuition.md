# Oldham Tuition Centre — sales demo

Live demo instance: **pdc-phiof** (`ORGANIZATION_ID=phiof`). Handoff mode (no slot booking), tuition-themed inbox, OTC knowledge and persona.

Reference site: [oldhamtuitioncentre.com](https://oldhamtuitioncentre.com/)

## Setup (operator)

```bash
# From pdc-template
node scripts/apply-profile.mjs demos/oldham-tuition --wrangler ../pdc-phiof/workers/api/wrangler.toml

# Sync template → phiof (preserve client wrangler + env)
rsync -a --exclude node_modules --exclude .git --exclude 'workers/api/wrangler.toml' \
  --exclude 'apps/web/.env.local' --exclude '.env' \
  ./ ../pdc-phiof/

cd ../pdc-phiof/workers/api && pnpm run deploy

# Remote D1: remove gym data, apply OTC AI config
node ../../pdc-template/scripts/setup-oldham-tuition-demo.mjs

# Knowledge + vector index (setup script inserts chunks; then reindex)
WORKER_URL=https://pdc-phiof.justphiof.workers.dev \
  node ../../pdc-template/workers/api/scripts/ingest-knowledge.mjs

# Demo leads (only if inbox empty)
curl -X POST -b "session=..." "$WORKER_URL/admin/seed"
```

## Sales walkthrough script

1. **Settings** — Open Settings. Confirm tabs: **AI**, **Team**, **Demo** only (no Schedule). Open AI: academy name **Oldham Tuition Centre**, warm parent-focused tone.

2. **Inbox** — Show tuition-themed leads (GCSE Maths, KS2 English, Coding). Open **Amina Hassan**: engaged, handoff note for Saturday mornings — not booked.

3. **Knowledge** — From a test phone or simulate lead, ask: *"What subjects do you offer?"* — expect Maths, English, Science, Coding, FCL, small groups, Ofsted.

4. **Qualification** — New SMS: parent enquires about Year 10 Maths. AI asks name, subject, child; qualified message asks preferred times (no slot confirmation).

5. **Handoff** — Reply *"Saturday mornings work"*. Lead gets staff note; assessment shows handoff; status stays engaged.

6. **Guardrails** — Ask to book Tuesday 4pm exactly — AI should defer to team phone call, not confirm a slot. Replies should not over-use the parent's name.

7. **Demo tools** — Simulate lead (Olivia, GCSE Maths referral). Restore demo seed if needed.

## Acceptance checklist

- [ ] `preset_id` = `tuition-centre` in AI config
- [ ] 10 fact chunks in Knowledge (no conversation/playbook sources)
- [ ] "What subjects do you offer?" → factual answer from knowledge
- [ ] "How much does it cost?" → pricing guidance + assessment CTA
- [ ] Saturday preference → handoff note, status not `booked`
- [ ] No BJJ / Manchester / trial-slot confirm language

## What not to show

- No Manchester/Leeds gym locations or BJJ trial language.
- Class times in knowledge are **informational** only (Sat/Sun 11–1, Mon–Wed 4:15–6:15).

## Files

| Path | Purpose |
|------|---------|
| `demos/oldham-tuition/profile.json` | Capabilities + AI overrides |
| `demos/oldham-tuition/knowledge-chunks.json` | Portal knowledge pack |
| `packages/seed-data/src/leads-tuition-demo.ts` | Demo inbox leads (phiof seed) |
| `scripts/setup-oldham-tuition-demo.mjs` | D1 cleanup + AI SQL |
