# Phase 2 — /order Screens A/B

## Done
- **2.1–2.7** `/order` route + `plugins/order/OrderWorkspace` (tables → two-pane order, send via `POST /kitchen/orders`, orderKey retry). Login `?next=` + Worker verify redirect. Kitchen Fire tab untouched.

## Skipped / changed
- Playwright screenshots: not available as project dep — not faked.

## Blocked
- None.

## Verify
```bash
pnpm --filter @lead-intake/web exec tsc --noEmit
# with local worker + seed-service-day + dev-session: open /order
```

## Assumptions
- Floor plan from `/service/floor-plan`; Bar tile uses tableLabel `"Bar"`.
