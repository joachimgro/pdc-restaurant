# Phase 6 — Fennel data

## Done

- **6.1** `docs/trial/fennel-menu.json` matches plan: categories with `station` / `default_course`, items with `price_pence` (+ steak `choices`), top-level `quick_notes`.
- **6.2** `scripts/seed-fennel.mjs` upserts menu by category/item name (`available=1`, never deletes). Writes `quick_notes` into `venue_settings.brand_json.quickNotes` via `json_patch` so other brand keys (e.g. `kitchenLateMinutes`) are preserved. Also regenerates `apps/web/src/plugins/order/quickNotes.ts`. Order UI prefers `brand.quickNotes` from GET `/service/settings` when present.
- **6.3** `docs/trial/fennel-floor.json`: Dining Room / Bar / Garden with spoken labels (1–10, 12, B1–B5, G1–G4).

## Skipped / changed

- None material. Brand write preferred and implemented; constant file still synced as fallback.

## Blocked

- Real Fennel menu/floor copy if samples need replacing before service.

## Verify

- `node scripts/seed-fennel.mjs --local`
- `/order` note sheet shows seeded quick notes; kitchen late setting survives re-seed.

## Assumptions

- Sample JSON is acceptable until venue supplies final lists.
- D1 supports `json_patch` for brand merge.
