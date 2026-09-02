# Phase 4 — One kitchen board, 86, renames, Fennel seed

## Done
- **4.1** Tabs Order | Kitchen | Menu; Expo hidden; Ready+Served bumps; `KITCHEN_LATE_MINUTES`.
- **4.2** 86 on board + Menu toggles.
- **4.3–4.4** Renames; Fire form UI removed.
- **4.5** Category/item PATCH; station, default_course, choices editors.
- **4.6** `scripts/seed-fennel.mjs` + placeholder `docs/trial/fennel-*.json`.

## Skipped / changed
- None.

## Blocked
- Real Fennel floor/menu JSON from venue (Phase 6).

## Verify
```bash
cd workers/api && pnpm exec vitest run src/routes/kitchen.test.ts
# UI: /inbox?view=kitchen — Order opens /order
```

## Assumptions
- Placeholder Fennel JSON is sample data until venue fills it.
