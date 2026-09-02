# Phase 5 — Failure handling, devices, checklist

## Done

- **5.1–5.2** `createKitchenOrder` uses `AbortSignal.timeout(8000)`; abort/timeout → `NETWORK`. `OrderWorkspace.sendOrder`: Sending… while in flight; never clears ticket before 2xx; network/timeout/5xx → retry banner + one auto-retry after 2s (same `orderKey`); `ITEM_UNAVAILABLE` → “X is 86'd…” + line highlight + menu refetch; `UNAUTHORIZED`/`HTTP_401` → `/login?next=/order`.
- **5.3** Late threshold from `venue_settings.brand.kitchenLateMinutes` (fallback `KITCHEN_LATE_MINUTES` = 15). Admin control on Kitchen → Menu → “Kitchen late (minutes)” merges brand via GET/PUT `/service/settings` (no migration).
- **5.4** `manifest.webmanifest`: name “PDC Order”, short_name “Order”, `start_url` `/order`, `display` standalone, `orientation` landscape; icons/theme kept.
- **5.6** `docs/trial/CHECKLIST.md` with device setup, untrained 60s path, rush test, failure drills, paper fallback.

## Skipped / changed

- **5.5** Seated tiles + Fire mains — skipped (stretch).
- Settings UI: no dedicated Service settings editor for brand; control lives on Kitchen Menu tab (admin / `canManageTeam`).

## Blocked

- None.

## Verify

- Floor: `/order` send with wifi off → banner + auto-retry; 86 item → named banner.
- Kitchen Menu (admin): set late minutes; ticket aging uses it.
- `pnpm --filter @lead-intake/web exec tsc --noEmit`

## Assumptions

- Standalone PWA cookie behaviour unverified on device; same-site session cookie should work like Safari.
- `fetchVenueSettings` / day settings already expose `brand` as `z.record(z.unknown())`.
