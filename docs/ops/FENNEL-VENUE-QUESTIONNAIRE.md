# Fennel venue questionnaire (fill before onboarding)

Do **not** reuse `the-test-kitchen` seed. Answer from Fennel’s real floor. Return this file filled (or paste answers in chat).

## Identity

| # | Field | Your answer |
|---|--------|-------------|
| 1 | Legal / trading name (guest-facing) | |
| 2 | Booking slug (URL path, kebab-case) | |
| 3 | Timezone (IANA, e.g. Europe/London) | |
| 4 | Contact phone (guest-facing) | |
| 5 | Contact email (guest-facing) | |
| 6 | Full address text | |

## Branding (booking page)

| # | Field | Your answer |
|---|--------|-------------|
| 7 | Brand display name | |
| 8 | Primary brand colour (hex) | |
| 9 | Logo URL (or “none — text only”) | |
| 10 | Hero / atmosphere image URL (or “none”) | |

## Rooms

List each room:

| Room name | Online bookable? (Y/N) | Notes |
|-----------|------------------------|-------|
| | | |

## Tables

For each table (or attach a floor sketch + counts):

| Room | Label | Seats min | Seats max | Online bookable? | Priority (lower = preferred) | Shape (rect/circle/…) |
|------|-------|-----------|-----------|------------------|------------------------------|------------------------|
| | | | | | | |

**Totals expected:** ____ tables across ____ rooms.

## Combinations (joinable tables)

| Label | Member table labels | Seats min | Seats max | Online? |
|-------|---------------------|-----------|-----------|---------|
| | | | | |

## Service periods

| Name | Days (mon–sun) | Open | Close | Last seating | Slot interval (min) |
|------|----------------|------|-------|--------------|---------------------|
| | | | | | |

## Turn times

| Party size (or range) | Turn minutes | Applies to period(s) |
|-----------------------|--------------|----------------------|
| default | | all |
| | | |

## Pacing

| Period | Window / rule | Max covers (or parties) |
|--------|---------------|-------------------------|
| | | |

## Notifications / compliance

| # | Field | Your answer |
|---|--------|-------------|
| 11 | Quiet hours start (HH:MM local) | default 21:00 if blank |
| 12 | Quiet hours end (HH:MM local) | default 08:00 if blank |
| 13 | Retention months | default 24 if blank |
| 14 | Cancellation window (hours before start) | |
| 15 | Min lead minutes / max advance days | |
| 16 | Party size online min / max | |
| 17 | Review URL (or none) | |

## Ops

| # | Field | Your answer |
|---|--------|-------------|
| 18 | Keep `the-test-kitchen` as a separate test target? (Y/N) | recommend **Y** |
| 19 | Staff emails to invite | |

## Done when

Answers above are complete enough to build rooms, tables, periods, turn/pacing, settings, and a live booking URL `/book/<slug>` that reflects **Fennel**, not the demo seed.
