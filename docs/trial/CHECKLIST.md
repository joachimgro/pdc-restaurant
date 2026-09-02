# Fennel trial checklist

## Pre-service — device setup

- [ ] Two floor iPads + one kitchen wall iPad charged, brightness high, auto-lock off (or Guided Access on).
- [ ] Floor iPads: Add to Home Screen from `/order` (standalone PWA). Kitchen iPad: Safari at `/inbox?view=kitchen` under Guided Access.
- [ ] Staff accounts signed in (admin + floor members). Confirm session cookie survives app reopen.
- [ ] Chargers + hotspot ready as wifi fallback.
- [ ] `GET /health` green with the pinned deploy SHA.
- [ ] Fennel menu + floor seeded (`node scripts/seed-fennel.mjs --local` / remote as needed).
- [ ] Kitchen late minutes set (Menu tab, admin) — default 15.

## Untrained-person path (target under 60s)

Hand a floor iPad to someone who has not used the app. Expected taps:

1. Tables → pick a table
2. Covers → set 4
3. Serve mode → **As it comes**
4. Starters → 1 starter
5. Mains → 3 mains including a steak → pick temperature on the choice sheet
6. Note on one line → quick note chip
7. Drinks → 2 drinks
8. **Send to kitchen**

Pass if the kitchen board shows the tickets (kitchen + bar stations) under 60s with no coaching beyond “tap what you need.”

## Rush test

- [ ] 3 people, 2 floor iPads, kitchen board visible.
- [ ] 20 orders in 15 minutes across mixed tables / Bar.
- [ ] Board stays readable; Ready / Served bumps keep up; no duplicate tickets for one send.

## Failure drills

- [ ] **Wifi off mid-send:** banner “Not sent to kitchen. Tap to retry.”; one auto-retry after ~2s; after wifi returns, exactly one set of tickets for that `orderKey`.
- [ ] **86 then order:** 86 an item on Menu/board; try to send it → “X is 86'd, remove it to send”; line highlighted; menu refetch shows 86.
- [ ] **Double-tap Send:** same order twice quickly → one set of tickets (idempotent replay).
- [ ] **401 / expired session:** redirect to `/login?next=/order`.

## Fallback

- [ ] Trigger agreed: board down / both iPads dead / more than 2 failed sends in a row with no recovery.
- [ ] Paper pads + printed menu at the pass; kitchen writes tickets; floor calls orders.
- [ ] After recovery, do not re-enter paper tickets into the app (avoid duplicates).
