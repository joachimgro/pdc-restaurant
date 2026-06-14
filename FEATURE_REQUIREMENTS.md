# FEATURE_REQUIREMENTS.md

This file is only meaningful on feature branches (`feat/*`).
On `main`, it serves as the template.

When working on a feature branch, fill in:

- **Feature name:** e.g. "Booking integration"
- **Minimum schema version:** the lowest migration number in `workers/api/migrations/`
  that this feature requires. If the feature adds its own migrations, this is the
  highest migration number AFTER applying the feature's own migrations.
- **Built against base commit:** the `main` commit SHA this feature branch was
  last rebased onto. Update on every rebase.
- **New migrations introduced:** list any migration files added by this feature.

Before merging a feature branch into a client repo:

1. Verify the client's current `schema_version` is >= the feature's minimum, OR
2. Be prepared to apply the feature's own migrations after merge.

After merge, always run `pnpm deploy:remote` so migrations apply before the Worker
serves traffic. The Worker's schema gate (`EXPECTED_SCHEMA_VERSION` in
`workers/api/src/meta.ts`) returns HTTP 503 if D1 is behind the deployed code.
