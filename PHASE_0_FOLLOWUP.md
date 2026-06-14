# Phase 0 Follow-up — Migration audit (data inserts)

Audit of `workers/api/migrations/0001`–`0020` for hardcoded client-specific **data**
INSERTs (location slugs, business names, phone numbers, org-specific rows). Fixes are
listed for awareness only; only `0008` was changed in this session.

---

## Fixed in this session

### `0008_fix_location_overrides.sql`
- **Was:** `INSERT OR REPLACE INTO ai_location_overrides` for `manchester`, `leeds`, `bolton`, `stockport` with martial-arts schedule copy.
- **Problem:** FK to `locations(id)` — fails on fresh DB with zero location rows. Phase 0 violation (client data in git).
- **Now:** Comment-only no-op; table DDL lives in `0002_ai_knowledge.sql`.

---

## Active INSERT statements (not client-specific — OK)

| File | Statement | Notes |
|------|-----------|--------|
| `0015_phase0_config_boundary.sql` | `INSERT INTO leads_new SELECT * FROM leads` | Schema rebuild data copy, not seed data |
| `0019_meta_schema_version.sql` | `INSERT OR IGNORE INTO _meta (key, value) VALUES ('schema_version', '0000')` | Platform schema version baseline |

---

## Commented examples (not executed — report only)

| File | Content | Risk if uncommented |
|------|---------|---------------------|
| `0002_ai_knowledge.sql` | Commented `INSERT OR IGNORE INTO ai_config (...)` with `CHANGE_ME` org and placeholder academy strings | Would require matching `organizations` row; template placeholders only |
| `0006_location_schedules.sql` | Commented `INSERT OR IGNORE INTO location_programme_schedules` with example `main` location and `Adults BJJ` | FK to `locations`; client-specific if filled in |

---

## Comments referencing client/demo names (not INSERTs — report only)

| File | Line / content |
|------|----------------|
| `0004_ai_persona_human.sql` | Comment references seeding via `0002` INSERT block |
| `0005_lead_trial_slot.sql` | Comment: `e.g. Bolton: 17:00, 19:30, 20:30` (column purpose only) |
| `0010_manchester_schedules.sql` | Filename + header refer to removed Manchester demo schedule seed (file is intentionally empty) |

---

## No problematic INSERTs found in

`0001_schema.sql`, `0003_knowledge_chunks.sql`, `0007_lead_trial_proposed.sql`, `0009_location_confirmed.sql`,
`0010_manchester_schedules.sql`, `0011_lead_notes.sql`, `0012_lead_notes_table.sql`, `0013_staff_auth.sql`,
`0014_staff_roles.sql`, `0016_queue_processing_locks.sql`, `0017_leads_unique_phone.sql`,
`0018_lead_processing_locks.sql`, `0020_domain_events_org_created_index.sql`

---

## Recommended follow-ups (out of scope here)

1. Rename `0010_manchester_schedules.sql` to a neutral name (e.g. `0010_reserved_schedules.sql`) to avoid implying a Manchester default.
2. Remove or relocate commented INSERT templates in `0002` and `0006` to docs if they encourage copy-paste client data into migrations.
3. Document in README that fresh `pnpm deploy:remote` no longer requires pre-seeding locations for migration 0008.
