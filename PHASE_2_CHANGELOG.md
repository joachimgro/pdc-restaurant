# Phase 2 Changelog — Scoping, Constraints & Demo Tool Cleanup

Four targeted hardening fixes: phone uniqueness constraint, org-scoped queries (defence-in-depth),
deletion of a dangerous demo endpoint, and a startup warning when demo tools are on.

---

## Fix 1 — UNIQUE constraint on (organization_id, phone)

**Audit finding:** §2d — duplicate lead records could be created from the same phone number
under race conditions, each triggering its own AI reply chain.

### Files changed

#### `workers/api/migrations/0017_leads_unique_phone.sql` (new)
- Deduplicates existing data first (keeps oldest lead per org+phone via `ROW_NUMBER() OVER PARTITION BY`).
- Creates `UNIQUE INDEX idx_leads_org_phone ON leads(organization_id, phone)`.

#### `workers/api/src/db/inbound-sms.ts`
- Changed new-lead `INSERT` to `INSERT OR IGNORE` so a concurrent request that wins the race
  is silently ignored rather than throwing a constraint error.
- Added post-insert re-lookup: if the inserted `leadId` isn't the winner (another request beat
  us), route the message to the existing lead and return `isNew: false`.

---

## Fix 2 — getLead() now scoped by organization_id

**Audit finding:** §1a — `getLead()` fetched by UUID alone. No cross-tenant leakage is currently
possible (each client has its own D1), but defence-in-depth demands org-scoping on every query.

### Files changed

#### `workers/api/src/db/leads.ts`
- `getLead()` query changed to `WHERE id = ? AND organization_id = ?`, binding `env.ORGANIZATION_ID`.
- Added `organization_id: string` to the `LeadRow` type (was missing; needed for `rowToLead`).

---

## Fix 3 — getLocationName() now scoped by organization_id

**Audit finding:** §1a — `getLocationName()` fetched locations by ID alone with no org scope.

### Files changed

#### `workers/api/src/db/leads.ts`
- `getLocationName()` signature updated to accept `orgId: string`.
- Query changed to `WHERE id = ? AND organization_id = ?`.
- `rowToLead()` passes `row.organization_id` to `getLocationName()`.

---

## Fix 4 — /admin/reset-all deleted

**Audit finding:** §1d — `POST /admin/reset-all` wiped the entire database. Confirmation string
was public in source code. A mis-deploy with `ENABLE_DEMO_TOOLS=true` on production would
expose it to any authenticated staff member. An unrecoverable wipe is never acceptable in
production code. Dev resets should be done via `wrangler d1 execute`, not an API route.

### Files changed

#### `workers/api/src/routes/admin.ts`
- `handleAdminResetAll` function and its `RESET_CONFIRM` constant completely deleted.
- Import of `deleteAllLeadsAndData` removed.

#### `workers/api/src/index.ts`
- Route `if (path === "/admin/reset-all")` deleted.
- Import of `handleAdminResetAll` removed.
- **Added startup warning** on every request when `ENABLE_DEMO_TOOLS === "true"`:
  ```
  ⚠️ DEMO TOOLS ARE ENABLED. Disable for production: set ENABLE_DEMO_TOOLS=false in wrangler.toml
  ```

#### `workers/api/src/env.ts`
- Updated comment for `ENABLE_DEMO_TOOLS` to remove mention of `/admin/reset-all`.

#### `apps/web/src/lib/api/admin.ts`
- `resetAllLeads()` function and `RESET_CONFIRM` export deleted.

#### `apps/web/src/store/inbox-store.ts`
- `deleteAllLeads` removed from `InboxState` interface.
- `deleteAllLeads` action implementation removed.
- Import of `resetAllLeads` removed.

#### `apps/web/src/components/inbox/AdminPanel.tsx`
- "Delete all contacts" section (confirmation input + danger button) completely removed.
- Import of `RESET_CONFIRM` removed; `deleteAll` store reference removed.
- State type simplified: `"delete" | "seed"` → `"seed"`.

#### `README.md`
- `ENABLE_DEMO_TOOLS` table row updated to remove reference to `/admin/reset-all`.

---

## Verification results

| Check | Status |
|---|---|
| `idx_leads_org_phone` UNIQUE index created by migration 0017 | ✓ |
| All migrations 0001–0017 apply cleanly on SQLite | ✓ |
| `tsc --noEmit` (worker API) | ✓ |
| `tsc --noEmit` (web app) | ✓ |
| `grep reset-all workers/api/src/ apps/web/src/` — zero hits | ✓ |
| `grep "DELETE ALL LEADS" workers/api/src/ apps/web/src/` — zero hits | ✓ |
| `getLead()` includes `AND organization_id = ?` | ✓ |
| `getLocationName()` includes `AND organization_id = ?` | ✓ |
| `/admin/seed` still exists and still requires `ENABLE_DEMO_TOOLS=true` | ✓ |
| `/leads/simulate` still exists and still requires `ENABLE_DEMO_TOOLS=true` | ✓ |
| Startup warning fires when `ENABLE_DEMO_TOOLS=true` | ✓ |

---

## Remaining demo tool routes

The following routes still exist and are fully intact. All require `ENABLE_DEMO_TOOLS=true`
in `wrangler.toml` (this env var defaults to `"false"` in the template).

| Route | Method | Purpose |
|---|---|---|
| `/admin/seed` | POST | Inserts demo lead data from `buildSeedLeads()`. No-ops if leads already exist. Used to populate a fresh inbox for sales demos. |
| `/leads/simulate` | POST | Simulates a new inbound lead using `OLIVIA_SIMULATE` fixture. Triggers the full AI pipeline on queue. Used to demo the AI reply flow live. |

Neither route destroys data. Both are safe to run on a demo instance.

To reset a dev/staging database without the deleted route, use:
```bash
wrangler d1 execute pdc-{slug}-db --remote --command "DELETE FROM leads"
# or drop and re-migrate:
wrangler d1 migrations apply pdc-{slug}-db --remote
```
