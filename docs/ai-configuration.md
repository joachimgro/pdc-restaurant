# AI configuration

The SMS assistant has four layers:

| Layer | Where | Who edits |
|-------|--------|-----------|
| **Platform playbook** | `workers/api/src/ai/playbooks/platform.ts` | Template maintainers |
| **Vertical playbook** | `workers/api/src/ai/playbooks/{preset}.ts` | Template maintainers; selected via `preset_id` |
| **Persona + qualification** | D1 `ai_config` | Settings → AI |
| **Facts** | D1 knowledge, Vectorize, location schedules | Knowledge + Locations |

Conversation style and flow are **not** stored in knowledge chunks — RAG retrieves facts only.

## Quick start for a new client

1. Fork/rsync `pdc-template` to your client repo.
2. Deploy Worker + D1; run migrations (`pnpm db:migrate:remote`).
3. Open **Settings → AI** and **Apply preset** (e.g. martial arts, music school) or use generic.
4. Set **business name**, tone, goals, and rules.
5. Add **Locations** and programme schedules (feeds `{{location_names}}` and `{{programme_names}}` in templates).
6. Add **Knowledge** chunks and run ingest.
7. Test inbound SMS: qualification uses your templates; real questions route to LLM + RAG.

## Qualification templates

Templates are plain text with allowlisted parameters (never from user input):

- `{{business_name}}` — academy name from AI config
- `{{first_name}}` — lead first name when known
- `{{location_names}}` — comma list from D1 locations
- `{{programme_names}}` — distinct programmes from schedules
- `{{interest}}`, `{{location_name}}` — current lead state
- `{{interest_label}}`, `{{location_label}}`, `{{trial_label}}` — field labels

### Hybrid routing

1. **Topic guard** runs first (injection / off-topic deflection).
2. If the lead still needs qualification and the message **looks like a question**, the pipeline skips templates and uses **LLM + RAG + judge**.
3. Otherwise a template is rendered for the missing-field state.

## Presets

Example presets live in `workers/api/presets/`. They are not auto-seeded; use **Apply preset** in Settings → AI or `POST /admin/ai-config/apply-preset` with `{ "presetId": "martial-arts" }`. This sets `preset_id`, qualification templates, and default tone/goals/rules for the vertical.

## API

- `GET /admin/ai-config` — full config + preset list (includes `presetId`)
- `PATCH /admin/ai-config` — staff session required
- `POST /admin/ai-config/apply-preset` — `{ presetId }`

## Security

- Templates are not LLM-generated; only fixed params are substituted.
- Injection attempts are deflected before qualification or LLM.
- Judge blocks medical advice and invented pricing.
