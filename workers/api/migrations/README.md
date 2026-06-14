# D1 migrations

Migrations are applied in numeric order via `wrangler d1 migrations apply`.

## Schema version convention (from migration 0019 onward)

Every **new** migration file must end with:

```sql
UPDATE _meta SET value = 'NNNN', updated_at = datetime('now') WHERE key = 'schema_version';
```

where `NNNN` is the four-digit migration number (e.g. `0021` for `0021_foo.sql`).

The Worker build declares the expected version in `workers/api/src/meta.ts` as
`EXPECTED_SCHEMA_VERSION`. It must match the highest migration number in this
directory. On each request (cached per Worker instance), D1 `_meta.schema_version`
is compared to that constant; a mismatch returns HTTP 503 on all routes except
`/health`.

## Do not retroactively edit old migrations

Migrations `0001`–`0018` have already run on existing client databases. Do not add
`_meta` UPDATE lines to them. Migration `0019` creates `_meta` and establishes
the version baseline for deployments going forward.
