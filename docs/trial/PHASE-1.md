# Phase 1 — Schema and API

## Done
- **1.1** Added template `0047_waitlist_production.sql` (waitlist TTL), then `0048_trial_ordering.sql`. Restaurant received both. `EXPECTED_SCHEMA_VERSION` → `0048`.
- **1.2** Columns: `default_course`, `available`, `unavailable_at`, `choices`, `serve_mode`, `covers`, `order_key` (+ unique index), item `course`. **Skipped** category `station` ALTER (exists since 0043).
- **1.3** `POST /kitchen/orders` — station grouping, batch write, idempotent `order_key`, `409 ITEM_UNAVAILABLE`.
- **1.4–1.6** Choices validation on create; availability PATCH; menu/board projections include new fields; courses ordered starter→main→dessert→null.
- **1.7** Tests extended (13 kitchen+meta passing).

## Skipped / changed
- Clean template tip was **0046** (0047 only in WIP stash); recreated 0047 from documented waitlist TTL then 0048.

## Blocked
- None.

## Verify
```bash
cd workers/api && pnpm exec vitest run src/routes/kitchen.test.ts src/meta.test.ts
```

## Assumptions
- Station resolved from `menu_categories.station` (fallback item station).
