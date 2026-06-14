# Client setup — profiles and handoff vs scheduling

PDC ships with **handoff mode** as the template default: the AI qualifies leads, answers from Knowledge, captures preferred times, and hands off to staff. Slot booking and the Schedule settings tab are opt-in via capability flags.

## Capability flags

Set in `workers/api/wrangler.toml`:

| Variable | Default (template) | When `true` |
|----------|-------------------|-------------|
| `ENABLE_SIMPLE_SCHEDULING` | `false` | Trial/slot booking flow, Schedule UI, schedule RAG chunks |
| `ENABLE_MULTI_LOCATION` | `false` | Location required in qualification; multi-venue Schedule |
| `ENABLE_DEMO_TOOLS` | `false` | `/admin/seed`, simulate lead, Demo settings tab |

The inbox Settings UI reads `GET /admin/capabilities` and hides Schedule when `simpleScheduling` is off (default tab: **AI**).

## Vertical profiles

Profiles live in `profiles/` and demo packs in `demos/{name}/`.

| Profile | Scheduling | Use case |
|---------|------------|----------|
| `generic` | off | Default service business |
| `tuition-centre` | off | Tuition / tutoring handoff |
| `music-school` | off | Music school handoff |
| `martial-arts` | on | MMA / BJJ gym with booking |

Apply a profile to a client wrangler.toml:

```bash
# Template handoff (tuition)
node scripts/apply-profile.mjs tuition-centre --wrangler workers/api/wrangler.toml

# Gym client with booking
node scripts/apply-profile.mjs martial-arts --wrangler ../pdc-acme/workers/api/wrangler.toml

# Sales demo pack
node scripts/apply-profile.mjs demos/oldham-tuition --wrangler ../pdc-phiof/workers/api/wrangler.toml
```

The script patches capability vars and prints next steps (deploy, apply preset, seed knowledge).

## AI layers (playbooks + facts)

| Layer | Where | What |
|-------|--------|------|
| Platform | Code (`workers/api/src/ai/playbooks/platform.ts`) | Human SMS, anti-repeat, name discipline — every client |
| Vertical | Code per preset (`tuition-centre`, `martial-arts`, …) | Parent tone, gym consultative routing, handoff vs booking |
| Persona | `ai_config` tone, goals, rules | Thin brand voice (3–6 lines) |
| Facts | D1 knowledge chunks | Prices, subjects, address, policies only |

Applying a preset sets `preset_id` in D1 and loads the vertical playbook automatically. Copy fact templates from `templates/knowledge/` — do not put conversation style in knowledge.

After deploy:

1. **Apply preset** — Settings → AI → Apply preset, or `POST /admin/ai-config/apply-preset` with `{ "presetId": "tuition-centre" }`.
2. **Persona** — Settings → AI for academy name, tone, goals, rules (demo packs include suggested copy in `profile.json`).
3. **Knowledge** — Add chunks in Admin or `node scripts/seed-demo-knowledge.mjs demos/oldham-tuition/knowledge-chunks.json $WORKER_URL`.
4. **Reindex** — Happens automatically on chunk create; or `POST /admin/knowledge/reindex`.

## Handoff vs scheduling

**Handoff (default)**  
- Qualification collects name + interest (and child for tuition preset).  
- `location` is stripped from required fields when multi-location is off.  
- Preferred days/times → staff note on the lead; status stays engaged (never `booked`).  
- AI must not confirm trial slots (enforced in prompt + pipeline gates).

**Scheduling (gym clients)**  
- Set both capability flags `true`, apply `martial-arts` profile.  
- Configure venues and weekly timetables in Settings → Schedule.  
- Booking flow proposes and confirms trial slots as before.

## New client checklist

1. Fork/rsync `pdc-template` → `pdc-{slug}`.
2. Create Cloudflare resources (D1, Vectorize, Queue, KV) — see [README](../README.md).
3. `node scripts/apply-profile.mjs <profile> --wrangler workers/api/wrangler.toml`
4. Deploy Worker + web app; run D1 migrations.
5. Sign in as super admin; invite client team.
6. Apply preset, edit AI persona, add Knowledge from client website.
7. Twilio + Resend secrets; smoke-test inbound SMS.

See also: [AI configuration](./ai-configuration.md), [plugins](./plugins.md), [Oldham Tuition demo](./demos/oldham-tuition.md).

## Syncing template → client (ongoing updates)

After bug fixes or features land in `pdc-template`, push code to a client repo without touching client config or live data:

```bash
# From pdc-template
rsync -a --exclude node_modules --exclude .git \
  --exclude 'workers/api/wrangler.toml' \
  --exclude 'apps/web/.env.local' \
  --exclude '.env' \
  ./ ../pdc-{slug}/

cd ../pdc-{slug}/workers/api && pnpm run deploy
# If the template added SQL migrations:
pnpm exec wrangler d1 migrations apply pdc-{slug}-db --remote
```

**Preserved (not overwritten):**

| Path | Why |
|------|-----|
| `workers/api/wrangler.toml` | Worker name, D1/Vectorize/KV IDs, `ORGANIZATION_ID`, capability flags |
| `apps/web/.env.local` | `NEXT_PUBLIC_API_URL` for the Next.js app |
| `.env` | Root `WORKER_URL` for scripts |

**Also untouched by rsync** (live in Cloudflare, not the repo): D1 rows (leads, `ai_config`, knowledge chunks), Vectorize index, Worker secrets (`wrangler secret put`).

**Do not re-run** demo setup scripts (e.g. `setup-oldham-tuition-demo.mjs`) unless you intend to reset AI persona / scrub gym data — routine code sync + deploy is enough.
