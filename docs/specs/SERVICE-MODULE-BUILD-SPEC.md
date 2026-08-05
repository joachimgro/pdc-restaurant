# MASTER BUILD SPEC — Service Modules (Reservations, Floor Plan, Waitlist, Deposits)

**Target repo:** `pdc-template` (feature branches) → merged into `pdc-phiof`
**Baseline:** `ARCHITECTURE-AUDIT.md`, schema version `0033`
**Target schema version on completion:** `0040`
**Author of record:** architecture agreed with Joachim Grochowski, Phiof Digital
**Status:** Phase 4 merged — next deliverable is Phase 5+6 (guest booking + notifications) as one closed loop

---

## 0. How to use this document

You are implementing against an **existing production codebase**. Read `ARCHITECTURE-AUDIT.md` first. This spec assumes you have.

### Rules of engagement

1. **Follow existing conventions, not your preferences.** Raw D1 SQL via `env.DB.prepare().bind()`. No ORM. No Hono. Sequential `if (path === …)` dispatch in `workers/api/src/index.ts`. Zod schemas in `packages/shared-types`. Zustand for web state. Custom components, no UI library.
2. **Do not refactor the AI pipeline.** `workers/api/src/ai/pipeline.ts` is a 700-line load-bearing orchestrator. Reservations do **not** route through `generateAiReply()`. Phase 8 adds one narrow hook; nothing before that touches it.
3. **One migration per phase, applied in order, `EXPECTED_SCHEMA_VERSION` bumped in the same commit.** Deploying a Worker whose expected version exceeds the applied D1 version 503s all traffic. Migrate before deploy, always.
4. **Every new table carries `organization_id` and `location_id`.** One venue today, multi-venue later. Never add a table that would need backfilling for that.
5. **Stop at each phase gate.** Each phase below has acceptance criteria. Run `pnpm test` and the listed manual checks before starting the next phase. Do not build phases 1–8 in one pass.
6. **When this spec and the existing code disagree, stop and flag it.** Do not silently pick one.

### Model routing (for the human running this)

| Phase | Suggested model | Why |
|---|---|---|
| 1, 3, 4 | Fable 5 | Migrations against live schema, availability engine, concurrency correctness |
| 2, 5, 6, 7 | Opus 5 | UI, CRUD, templates — high volume, well-specified |
| 8 | Fable 5 | Touches the AI pipeline |

---

## 1. What we are building

A reservations and waitlist system for restaurants and bars, as installable modules on the PDC platform, forming the first surface of an eventual all-in-one venue suite.

### In scope

- **Guest booking page** — public, no account, mobile-first, magic-link management
- **Floor plan** — rooms, zones, drag-and-drop table layout, auto-assignment
- **Manager console** — day view, floor view, reservation drawer, walk-ins, service actions
- **Waitlist** — walk-in queue and date waitlist, SMS notify, one-tap convert to reservation
- **Deposits and card-on-file** — Stripe, policy-driven, no-show protection
- **Notifications** — Resend email + Telnyx SMS, scheduled reminders, guest replies
- **Stats** — covers, utilisation, no-show rate, waitlist conversion, source mix

### Explicitly out of scope (do not build)

- Table ordering, KDS, tabs, payments-at-table, menu management, stock, staff rotas
- Multi-venue switching UI (data model supports it; UI does not ship)
- Guest accounts with passwords
- Marketing campaigns or bulk email
- Anything in the tuition/Anthem demo path

### Design partners (real venues, week-one users)

A gastro pub with rooms, the GM at Australasia Manchester, and the owner of Fennel in Swinton. High covers, real service pressure. Two consequences that drive design decisions throughout:

- **The manager console will be used on an iPad, standing up, in a dim room, mid-service, one-handed.** Touch targets ≥ 44px. Nothing critical behind a hover. Dark theme is not a style choice.
- **The guest surface will mostly be a phone, often at 11pm, often slightly drunk.** Every step must be recoverable. No dead ends. If we can't take the booking, we take the waitlist entry.

---

## 2. Repo and branch strategy

### Branches on `pdc-template`

| Branch | Contents | Depends on |
|---|---|---|
| `feat/service-core` | Migrations 0034–0035, venue settings, rooms, tables, service periods, floor plan editor | — |
| `feat/reservations` | Migration 0036, availability engine, assignment engine, reservation CRUD | `service-core` |
| `feat/service-console` | Manager today/floor/timeline console, `GET /service/day` | `reservations` — **merged to `main`** |
| `feat/guest-loop` | **Phases 5+6 together:** public booking + confirmation/reminder notifications (one demoable closed loop) | **`main`** (console already merged — do not stack on `feat/service-console`) |
| `feat/waitlist` | Migration 0038, waitlist queue, notify, convert | `guest-loop` |
| `feat/payments` | Migration 0039, Stripe deposits and card-on-file | `guest-loop` |
| `feat/service-stats` | Stats endpoints and workspace | `guest-loop`, `waitlist` |

Each branch merges to `pdc-template main` when its phase gate passes. `pdc-phiof` merges `upstream/main` after each.

### Working method

Use a separate `git worktree` per branch, one Claude Code session each. Do not switch branches inside a live session — migrations and generated types will desync.

### `pdc-phiof` transformation (Phase 0)

`pdc-phiof` is currently configured as an Anthem Tuition music-lessons demo. Anthem is **not** live on this Worker, so the demo data is disposable. Phase 0:

1. New D1 database `pdc-phiof-service-db` and a new Worker `pdc-phiof-service` — **do not migrate the tuition database in place.** Keep the demo intact and reachable until the venue demos are signed.
2. Copy `wrangler.toml`, change `name`, `database_name`, `database_id`, Vectorize index, queue names, KV namespace.
3. Set `ENABLE_DEMO_TOOLS = "false"`, `ENABLE_SIMPLE_SCHEDULING = "false"`, `ENABLE_MULTI_LOCATION = "false"`.
4. Add new flags: `ENABLE_SERVICE = "true"`, `ENABLE_RESERVATIONS`, `ENABLE_WAITLIST`, `ENABLE_DEPOSITS`.
5. Do not import tuition seed data. New seed script `scripts/seed-venue-demo.mjs` (Phase 1).

Client deployments continue to follow the existing pattern: one fresh Cloudflare Worker + D1 per client, `ORGANIZATION_ID` set per deployment. The booking page is served per venue at a subdomain resolved by `venue_settings.booking_slug`.

---

## 3. Domain model

Concepts before schema. Get these right and the tables follow.

| Concept | Definition | Notes |
|---|---|---|
| **Venue** | A `locations` row. Reuses the existing table. | One per deployment for now |
| **Room** | A named area within a venue with its own floor canvas. "Main dining", "Terrace", "Mezzanine", "Bar". | Zones in the UI |
| **Table** | A seatable object with a position on a room canvas, a capacity range, and a shape. | `dining_tables` — never `tables`, that name is a footgun in SQL |
| **Combination** | A pre-declared set of tables that can be joined for a larger party. | Explicit, not inferred. Staff know which tables actually join |
| **Service period** | A named bookable window on a weekday. "Dinner, Fri, 17:30–22:00, last seating 21:00". | Replaces `location_programme_schedules` for venues |
| **Turn time** | Minutes a party of size N occupies a table. | Rule table, by party size and period |
| **Slot** | A candidate start time, derived — never stored. | Derived on read; storing slots is the mistake that makes availability rot |
| **Reservation** | A booked party: date, time, size, guest, tables, status. | The core entity |
| **Hold** | A short-lived lock on tables during checkout. | TTL, self-expiring |
| **Waitlist entry** | A party wanting a table, either now (walk-in) or on a full date. | Two kinds, one table |
| **Guest** | A `contacts` row plus a `guest_profiles` row. | **Reuses the existing contact identifier architecture** |
| **Payment** | A Stripe deposit or saved card tied to a reservation. | Never stores card data |

### Guest identity — reuse `contacts`

Decision: **reuse `contacts` + `contact_identifiers`.** A diner and an enquirer are the same person, and the venue wants one guest history, not two. Concretely:

- On booking, call `findContactByIdentifier(env, 'email', email)`, then `'phone'`. If found, link. If not, create a contact and insert both identifiers.
- `reservations` stores `contact_id` **and** a snapshot of name/phone/email at booking time. The snapshot is what appears on the run sheet; the contact is what accumulates history. Do not join to `contacts` to render a service view — a renamed contact must not silently rewrite last Tuesday's bookings.
- Dining-specific attributes (allergies, VIP, no-show count) live in `guest_profiles`, keyed by `contact_id`.

**Landmine from the audit:** `leads` has `UNIQUE(organization_id, phone)`. Reservations must **not** create `leads` rows. Two couples sharing a phone number is normal; a unique constraint on it would reject the second booking. Reservations reference `contacts` only.

---

## 4. Migrations

Seven migrations, `0034`–`0040`. Each ends by setting `_meta.schema_version`. All follow the existing file naming in `workers/api/migrations/`.

### `0034_service_core.sql`

```sql
CREATE TABLE IF NOT EXISTS venue_settings (
  location_id TEXT PRIMARY KEY REFERENCES locations(id),
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  timezone TEXT NOT NULL DEFAULT 'Europe/London',
  booking_slug TEXT UNIQUE,
  slot_interval_min INTEGER NOT NULL DEFAULT 15,
  default_turn_minutes INTEGER NOT NULL DEFAULT 90,
  grace_after_close_min INTEGER NOT NULL DEFAULT 30,
  min_party_online INTEGER NOT NULL DEFAULT 1,
  max_party_online INTEGER NOT NULL DEFAULT 8,
  large_party_message TEXT,
  min_lead_minutes INTEGER NOT NULL DEFAULT 60,
  max_advance_days INTEGER NOT NULL DEFAULT 90,
  hold_ttl_seconds INTEGER NOT NULL DEFAULT 600,
  auto_assign_tables INTEGER NOT NULL DEFAULT 1,
  allow_online_waitlist INTEGER NOT NULL DEFAULT 1,
  cancellation_window_hours INTEGER NOT NULL DEFAULT 24,
  brand_json TEXT,
  contact_phone TEXT,
  contact_email TEXT,
  address_text TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS rooms (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  location_id TEXT NOT NULL REFERENCES locations(id),
  name TEXT NOT NULL,
  accent_color TEXT,
  online_bookable INTEGER NOT NULL DEFAULT 1,
  canvas_width INTEGER NOT NULL DEFAULT 1200,
  canvas_height INTEGER NOT NULL DEFAULT 800,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_rooms_location ON rooms(location_id, sort_order);

CREATE TABLE IF NOT EXISTS dining_tables (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  location_id TEXT NOT NULL REFERENCES locations(id),
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  seats_min INTEGER NOT NULL DEFAULT 1,
  seats_max INTEGER NOT NULL,
  shape TEXT NOT NULL DEFAULT 'round',
  pos_x INTEGER NOT NULL DEFAULT 0,
  pos_y INTEGER NOT NULL DEFAULT 0,
  width INTEGER NOT NULL DEFAULT 90,
  height INTEGER NOT NULL DEFAULT 90,
  rotation INTEGER NOT NULL DEFAULT 0,
  online_bookable INTEGER NOT NULL DEFAULT 1,
  assign_priority INTEGER NOT NULL DEFAULT 100,
  is_active INTEGER NOT NULL DEFAULT 1,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(location_id, label)
);
CREATE INDEX IF NOT EXISTS idx_dining_tables_room ON dining_tables(room_id, is_active);
CREATE INDEX IF NOT EXISTS idx_dining_tables_location ON dining_tables(location_id, is_active);

CREATE TABLE IF NOT EXISTS table_combinations (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  location_id TEXT NOT NULL REFERENCES locations(id),
  label TEXT NOT NULL,
  seats_min INTEGER NOT NULL,
  seats_max INTEGER NOT NULL,
  assign_priority INTEGER NOT NULL DEFAULT 300,
  online_bookable INTEGER NOT NULL DEFAULT 1,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS table_combination_members (
  combination_id TEXT NOT NULL REFERENCES table_combinations(id) ON DELETE CASCADE,
  table_id TEXT NOT NULL REFERENCES dining_tables(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (combination_id, table_id)
);
CREATE INDEX IF NOT EXISTS idx_combo_members_table ON table_combination_members(table_id);

INSERT OR REPLACE INTO _meta (key, value, updated_at)
VALUES ('schema_version', '0034', datetime('now'));
```

**Shape values:** `round` | `square` | `rect` | `booth` | `banquette` | `bar_stool` | `high_top` | `sofa`. Rendering is driven by shape; capacity is not inferred from it.

**Coordinate space:** integer grid units on the room canvas (default 1200×800), origin top-left. The client scales to viewport. Snap to 10 units.

### `0035_service_periods.sql`

```sql
CREATE TABLE IF NOT EXISTS service_periods (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  location_id TEXT NOT NULL REFERENCES locations(id),
  name TEXT NOT NULL,
  day_of_week TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  last_seating_time TEXT NOT NULL,
  slot_interval_min INTEGER,
  online_bookable INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_service_periods_day
  ON service_periods(location_id, day_of_week, is_active);

CREATE TABLE IF NOT EXISTS service_period_rooms (
  service_period_id TEXT NOT NULL REFERENCES service_periods(id) ON DELETE CASCADE,
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  PRIMARY KEY (service_period_id, room_id)
);

CREATE TABLE IF NOT EXISTS turn_time_rules (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  location_id TEXT NOT NULL REFERENCES locations(id),
  service_period_id TEXT REFERENCES service_periods(id) ON DELETE CASCADE,
  party_min INTEGER NOT NULL,
  party_max INTEGER NOT NULL,
  turn_minutes INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_turn_rules_location ON turn_time_rules(location_id);

CREATE TABLE IF NOT EXISTS pacing_rules (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  location_id TEXT NOT NULL REFERENCES locations(id),
  service_period_id TEXT REFERENCES service_periods(id) ON DELETE CASCADE,
  interval_min INTEGER NOT NULL DEFAULT 15,
  max_covers INTEGER,
  max_bookings INTEGER,
  applies_from TEXT,
  applies_to TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS availability_exceptions (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  location_id TEXT NOT NULL REFERENCES locations(id),
  service_date TEXT NOT NULL,
  kind TEXT NOT NULL,
  start_time TEXT,
  end_time TEXT,
  room_id TEXT REFERENCES rooms(id) ON DELETE CASCADE,
  table_id TEXT REFERENCES dining_tables(id) ON DELETE CASCADE,
  override_last_seating TEXT,
  note TEXT,
  created_by_staff_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_exceptions_date
  ON availability_exceptions(location_id, service_date);

INSERT OR REPLACE INTO _meta (key, value, updated_at)
VALUES ('schema_version', '0035', datetime('now'));
```

**`kind` values:** `closed` (whole day) | `special_hours` (overrides period times) | `block_room` | `block_table` | `no_online` (staff-only bookings that day) | `private_hire`.

**`day_of_week` values:** `mon` `tue` `wed` `thu` `fri` `sat` `sun` — matches the existing `location_programme_schedules` convention.

### `0036_reservations.sql`

```sql
CREATE TABLE IF NOT EXISTS reservations (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  location_id TEXT NOT NULL REFERENCES locations(id),
  reference TEXT NOT NULL,
  contact_id TEXT REFERENCES contacts(id),
  guest_name TEXT NOT NULL,
  guest_phone TEXT,
  guest_email TEXT,
  party_size INTEGER NOT NULL,
  service_date TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  starts_at_utc TEXT NOT NULL,
  service_period_id TEXT REFERENCES service_periods(id),
  room_id TEXT REFERENCES rooms(id),
  status TEXT NOT NULL DEFAULT 'confirmed',
  source TEXT NOT NULL DEFAULT 'online',
  assignment_locked INTEGER NOT NULL DEFAULT 0,
  occasion TEXT,
  allergies TEXT,
  guest_notes TEXT,
  staff_notes TEXT,
  tags_json TEXT,
  deposit_required_pence INTEGER NOT NULL DEFAULT 0,
  payment_id TEXT,
  seated_at TEXT,
  finished_at TEXT,
  cancelled_at TEXT,
  cancelled_by TEXT,
  cancel_reason TEXT,
  no_show_marked_at TEXT,
  marketing_opt_in INTEGER NOT NULL DEFAULT 0,
  created_by_staff_id TEXT REFERENCES staff_users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(organization_id, reference)
);
CREATE INDEX IF NOT EXISTS idx_reservations_service
  ON reservations(location_id, service_date, start_time);
CREATE INDEX IF NOT EXISTS idx_reservations_status
  ON reservations(location_id, service_date, status);
CREATE INDEX IF NOT EXISTS idx_reservations_contact
  ON reservations(organization_id, contact_id, starts_at_utc);
CREATE INDEX IF NOT EXISTS idx_reservations_upcoming
  ON reservations(organization_id, starts_at_utc, status);

CREATE TABLE IF NOT EXISTS reservation_tables (
  reservation_id TEXT NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
  table_id TEXT NOT NULL REFERENCES dining_tables(id),
  PRIMARY KEY (reservation_id, table_id)
);
CREATE INDEX IF NOT EXISTS idx_reservation_tables_table ON reservation_tables(table_id);

CREATE TABLE IF NOT EXISTS reservation_holds (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  location_id TEXT NOT NULL,
  service_date TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  party_size INTEGER NOT NULL,
  client_token_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  reservation_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_holds_live
  ON reservation_holds(location_id, service_date, expires_at, consumed_at);
CREATE INDEX IF NOT EXISTS idx_holds_token ON reservation_holds(client_token_hash);

CREATE TABLE IF NOT EXISTS reservation_hold_tables (
  hold_id TEXT NOT NULL REFERENCES reservation_holds(id) ON DELETE CASCADE,
  table_id TEXT NOT NULL REFERENCES dining_tables(id),
  PRIMARY KEY (hold_id, table_id)
);
CREATE INDEX IF NOT EXISTS idx_hold_tables_table ON reservation_hold_tables(table_id);

CREATE TABLE IF NOT EXISTS reservation_events (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  reservation_id TEXT NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  actor TEXT NOT NULL,
  data_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_reservation_events_res
  ON reservation_events(reservation_id, created_at);

INSERT OR REPLACE INTO _meta (key, value, updated_at)
VALUES ('schema_version', '0036', datetime('now'));
```

**`status` values:** `pending_payment` | `confirmed` | `seated` | `finished` | `cancelled` | `no_show` | `expired`.
Statuses that occupy a table: `pending_payment`, `confirmed`, `seated`. This set is a single exported constant, `OCCUPYING_STATUSES`, used by every availability query. Do not inline it.

**`source` values:** `online` | `phone` | `walk_in` | `staff` | `waitlist` | `import`.

**`reference`:** 6 characters, Crockford base-32 alphabet (no I, L, O, U), generated from `crypto.getRandomValues`. Guests read it out over the phone; ambiguous glyphs cost staff time.

**`starts_at_utc`:** computed at write time from `service_date` + `start_time` + venue timezone. Used only for ordering and reminder scheduling. **All display and availability logic uses the local date/time fields.** Do not derive local times from the UTC column — the clock change in October will produce a 23-hour day and an off-by-one service.

### `0037_notifications.sql`

Ships with Phase 5+6 (guest loop). Next sequential after `0036`. Do **not** leave number gaps for later phases.

```sql
-- waitlist_entry_id is nullable TEXT with NO FK: waitlist_entries lands in 0038.
-- Soft reference until Phase 7; do not add REFERENCES waitlist_entries here.
CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  location_id TEXT NOT NULL REFERENCES locations(id),
  reservation_id TEXT REFERENCES reservations(id) ON DELETE CASCADE,
  waitlist_entry_id TEXT,
  channel TEXT NOT NULL,
  template TEXT NOT NULL,
  to_address TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled',
  scheduled_for TEXT,
  sent_at TEXT,
  provider_message_id TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  error_text TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  payload_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_notifications_due
  ON notifications(status, scheduled_for);
CREATE INDEX IF NOT EXISTS idx_notifications_reservation
  ON notifications(reservation_id);

CREATE TABLE IF NOT EXISTS guest_access_tokens (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  reservation_id TEXT REFERENCES reservations(id) ON DELETE CASCADE,
  waitlist_entry_id TEXT,
  token_hash TEXT NOT NULL UNIQUE,
  scope TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  uses INTEGER NOT NULL DEFAULT 0,
  max_uses INTEGER,
  last_used_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_guest_tokens_res ON guest_access_tokens(reservation_id);

INSERT OR REPLACE INTO _meta (key, value, updated_at)
VALUES ('schema_version', '0037', datetime('now'));
```

**`status`:** `scheduled` | `sending` | `sent` | `failed` | `cancelled` | `skipped`.  
`sending` is the claim state for the dispatcher (see §11). `skipped` is used when send-time checks refuse delivery (e.g. reservation already cancelled).

### `0038_waitlist.sql`

```sql
CREATE TABLE IF NOT EXISTS waitlist_entries (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  location_id TEXT NOT NULL REFERENCES locations(id),
  contact_id TEXT REFERENCES contacts(id),
  guest_name TEXT NOT NULL,
  guest_phone TEXT,
  guest_email TEXT,
  party_size INTEGER NOT NULL,
  kind TEXT NOT NULL DEFAULT 'walk_in',
  service_date TEXT NOT NULL,
  requested_from TEXT,
  requested_to TEXT,
  status TEXT NOT NULL DEFAULT 'waiting',
  quoted_wait_min INTEGER,
  priority INTEGER NOT NULL DEFAULT 100,
  joined_at TEXT NOT NULL DEFAULT (datetime('now')),
  notified_at TEXT,
  notify_expires_at TEXT,
  notify_count INTEGER NOT NULL DEFAULT 0,
  seated_at TEXT,
  removed_at TEXT,
  removed_reason TEXT,
  reservation_id TEXT REFERENCES reservations(id),
  notes TEXT,
  created_by_staff_id TEXT REFERENCES staff_users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_waitlist_queue
  ON waitlist_entries(location_id, service_date, status, priority, joined_at);
CREATE INDEX IF NOT EXISTS idx_waitlist_contact
  ON waitlist_entries(organization_id, contact_id);

INSERT OR REPLACE INTO _meta (key, value, updated_at)
VALUES ('schema_version', '0038', datetime('now'));
```

**`kind`:** `walk_in` (here now, waiting for a table) | `date_waitlist` (wants a specific date that is full).
**`status`:** `waiting` | `notified` | `seated` | `converted` | `expired` | `left` | `cancelled`.

**Position is not stored.** It is computed as the row's rank within `(location_id, service_date, kind, status='waiting')` ordered by `priority ASC, joined_at ASC`. A stored position column goes stale on every insert and every removal and will be wrong within one service.

### `0039_payments.sql`

```sql
CREATE TABLE IF NOT EXISTS deposit_policies (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  location_id TEXT NOT NULL REFERENCES locations(id),
  name TEXT NOT NULL,
  mode TEXT NOT NULL,
  amount_pence INTEGER NOT NULL DEFAULT 0,
  no_show_fee_pence INTEGER NOT NULL DEFAULT 0,
  min_party INTEGER NOT NULL DEFAULT 1,
  service_period_id TEXT REFERENCES service_periods(id) ON DELETE CASCADE,
  day_of_week TEXT,
  date_from TEXT,
  date_to TEXT,
  cancellation_window_hours INTEGER NOT NULL DEFAULT 24,
  terms_text TEXT,
  priority INTEGER NOT NULL DEFAULT 100,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_deposit_policies_location
  ON deposit_policies(location_id, is_active, priority);

CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  location_id TEXT NOT NULL REFERENCES locations(id),
  reservation_id TEXT REFERENCES reservations(id) ON DELETE SET NULL,
  purpose TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'stripe',
  amount_pence INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'gbp',
  status TEXT NOT NULL,
  stripe_payment_intent_id TEXT,
  stripe_setup_intent_id TEXT,
  stripe_customer_id TEXT,
  stripe_payment_method_id TEXT,
  card_brand TEXT,
  card_last4 TEXT,
  captured_at TEXT,
  refunded_at TEXT,
  refunded_pence INTEGER NOT NULL DEFAULT 0,
  policy_id TEXT REFERENCES deposit_policies(id),
  error_text TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_payments_reservation ON payments(reservation_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_pi
  ON payments(stripe_payment_intent_id) WHERE stripe_payment_intent_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_si
  ON payments(stripe_setup_intent_id) WHERE stripe_setup_intent_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS payment_events (
  id TEXT PRIMARY KEY,
  payment_id TEXT REFERENCES payments(id) ON DELETE CASCADE,
  stripe_event_id TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR REPLACE INTO _meta (key, value, updated_at)
VALUES ('schema_version', '0039', datetime('now'));
```

**`mode`:** `none` | `card_on_file` | `deposit_fixed` | `deposit_per_person`.
**`purpose`:** `deposit` | `card_on_file` | `no_show_charge` | `cancellation_fee`.
**`status`:** `requires_action` | `saved` | `authorized` | `succeeded` | `failed` | `refunded` | `cancelled`.

Amounts are integer pence. Never floats, never strings.

### `0040_guest_profiles.sql`

```sql
CREATE TABLE IF NOT EXISTS guest_profiles (
  contact_id TEXT PRIMARY KEY REFERENCES contacts(id) ON DELETE CASCADE,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  vip INTEGER NOT NULL DEFAULT 0,
  allergies TEXT,
  dietary TEXT,
  seating_preference TEXT,
  notes TEXT,
  visit_count INTEGER NOT NULL DEFAULT 0,
  no_show_count INTEGER NOT NULL DEFAULT 0,
  cancel_count INTEGER NOT NULL DEFAULT 0,
  lifetime_covers INTEGER NOT NULL DEFAULT 0,
  last_visit_at TEXT,
  first_visit_at TEXT,
  marketing_opt_in INTEGER NOT NULL DEFAULT 0,
  marketing_opt_in_at TEXT,
  blocked INTEGER NOT NULL DEFAULT 0,
  blocked_reason TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_guest_profiles_vip
  ON guest_profiles(organization_id, vip) WHERE vip = 1;

INSERT OR REPLACE INTO _meta (key, value, updated_at)
VALUES ('schema_version', '0040', datetime('now'));
```

Counters are maintained by `recalcGuestProfile(env, contactId)`, called on reservation status transitions to `finished`, `no_show`, and `cancelled`. It recomputes from `reservations` rather than incrementing, so a corrected status heals the counters.

### Migration hygiene

- `workers/api/src/meta.ts` — `EXPECTED_SCHEMA_VERSION = "0040"` after the final migration lands. Bump it incrementally, one per phase.
- Never edit an applied migration. Correct forward.
- Given the 0032/0033 history (a table recreate cascade-deleted identifier rows), **do not use `DROP TABLE` + recreate anywhere in 0034–0040.** All of these are new tables; there is no reason to.

---

## 5. Availability engine

Location: `workers/api/src/plugins/service/availability.ts`

This is the correctness core of the product. It is a **pure function over loaded data** — no DB calls inside the algorithm, so it is trivially unit-testable. Load first, compute second.

### Signature

```typescript
export interface AvailabilityInput {
  settings: VenueSettings;
  periods: ServicePeriod[];          // for this weekday, active
  turnRules: TurnTimeRule[];
  pacingRules: PacingRule[];
  exceptions: AvailabilityException[]; // for this date
  tables: DiningTable[];             // active, with room
  combinations: Combination[];       // active, with member ids
  occupancy: OccupancyRow[];         // reservations + live holds
  serviceDate: string;               // YYYY-MM-DD
  partySize: number;
  now: Date;
  channel: 'online' | 'staff';
  roomIds?: string[];                // optional guest room preference
}

export interface AvailabilitySlot {
  time: string;                      // "19:15"
  periodId: string;
  available: boolean;
  endTime: string;
  turnMinutes: number;
  assignment: TableAssignment | null;
  remainingCovers: number | null;
  reason?: UnavailableReason;
}

export type UnavailableReason =
  | 'closed' | 'past' | 'too_soon' | 'too_far' | 'after_last_seating'
  | 'no_table' | 'pacing_full' | 'party_too_large' | 'staff_only';

export function computeAvailability(input: AvailabilityInput): AvailabilitySlot[];
```

**`reason` is returned for unavailable slots, always.** The guest UI hides them; the staff UI shows them greyed with the reason on tap. "Why can't I book 8pm" is the single most common manager question and answering it in the UI removes a support call per week.

### Algorithm

1. **Day-level exceptions.** If a `closed` exception covers the date, return all slots with `reason: 'closed'`.
2. **Effective periods.** For each active period matching the weekday, apply any `special_hours` exception to `start_time` / `last_seating_time`. If `channel === 'online'` and the period is not `online_bookable`, or a `no_online` exception applies, mark its slots `staff_only`.
3. **Party bounds.** If `channel === 'online'` and `partySize` outside `[min_party_online, max_party_online]`, return empty with `party_too_large` and surface `large_party_message` in the API response. Staff channel has no bound.
4. **Slot generation.** From `period.start_time` to `period.last_seating_time` inclusive, stepping by `period.slot_interval_min ?? settings.slot_interval_min`.
5. **Turn time.** `turnMinutes = turnRuleFor(partySize, periodId) ?? settings.default_turn_minutes`. Most specific rule wins: period-scoped beats venue-scoped; narrower party range beats wider.
6. **Window bounds.** `endTime = slot + turnMinutes`. Reject if `endTime > period.end_time + settings.grace_after_close_min`.
7. **Lead time.** Reject if `slot` is before `now + min_lead_minutes` (`too_soon`) or `serviceDate` beyond `now + max_advance_days` (`too_far`). Past slots on today are `past`.
8. **Table assignment.** Call `assignTables()` (§6) with the free-table set for `[slot, endTime)`. A table is free if no `OCCUPYING_STATUSES` reservation and no unexpired unconsumed hold overlaps the window, and no `block_table` / `block_room` exception applies. Overlap test: `NOT (existing.end <= slot OR existing.start >= endTime)`. Adjacent bookings do not overlap; a party leaving at 19:00 frees the table for a 19:00 booking.
9. **Pacing.** For each applicable pacing rule, bucket the slot into its interval and sum covers and bookings already committed in that bucket. If `covers + partySize > max_covers` or `bookings + 1 > max_bookings`, mark `pacing_full`. Pacing counts reservations by **start time bucket**, not occupancy — it exists to protect the kitchen from simultaneous orders.
10. **Return** every generated slot with `available` and, where available, the tentative `assignment`.

### Turn time defaults (seed these)

| Party | Minutes |
|---|---|
| 1–2 | 90 |
| 3–4 | 105 |
| 5–6 | 120 |
| 7–10 | 150 |
| 11+ | 180 |

### Occupancy loading

```typescript
export async function loadOccupancy(
  env: Env, locationId: string, serviceDate: string
): Promise<OccupancyRow[]>
```

One query per source, unioned in JS:

```sql
SELECT r.id, r.start_time, r.end_time, r.party_size, rt.table_id, 'reservation' AS kind
FROM reservations r
JOIN reservation_tables rt ON rt.reservation_id = r.id
WHERE r.location_id = ?1 AND r.organization_id = ?2
  AND r.service_date = ?3
  AND r.status IN ('pending_payment','confirmed','seated')

UNION ALL

SELECT h.id, h.start_time, h.end_time, h.party_size, ht.table_id, 'hold' AS kind
FROM reservation_holds h
JOIN reservation_hold_tables ht ON ht.hold_id = h.id
WHERE h.location_id = ?1 AND h.organization_id = ?2
  AND h.service_date = ?3
  AND h.consumed_at IS NULL
  AND h.expires_at > ?4
```

Unassigned reservations (staff bookings with no table yet) still consume pacing. Include them in a separate `unassigned` list so step 9 counts them.

---

## 6. Table assignment engine

Location: `workers/api/src/plugins/service/assignment.ts`

The thing that makes this product feel intelligent. It must be **deterministic** — same input, same output, every time — or you cannot test it and staff cannot trust it.

```typescript
export interface TableAssignment {
  tableIds: string[];
  combinationId: string | null;
  seatsTotal: number;
  score: number;
}

export function assignTables(
  freeTables: DiningTable[],
  combinations: CombinationWithMembers[],
  partySize: number,
  opts: {
    channel: 'online' | 'staff';
    preferredRoomIds?: string[];
    reserveLargeTables: boolean;
  }
): TableAssignment | null;
```

### Scoring

Lower is better. Evaluate all candidates, pick the minimum, tie-break by table label ascending.

**Single tables** — eligible if `seats_min <= partySize <= seats_max`, active, and (`channel === 'staff'` or `online_bookable`):

```
score  = (seats_max - partySize) * 10      // tightest fit wins
       + assign_priority / 10              // manager's stated preference
       + (preferredRoomIds && !preferredRoomIds.includes(room_id) ? 40 : 0)
       + (reserveLargeTables && seats_max >= partySize + 3 ? 60 : 0)
```

**Combinations** — eligible if all members free, `seats_min <= partySize <= seats_max`, and channel-permitted:

```
score  = (seats_max - partySize) * 10
       + assign_priority / 10
       + 100                               // always prefer a single table
       + (memberCount - 2) * 25            // prefer joining two over four
```

Return `null` if nothing fits. Null is a legitimate, expected answer — it is what triggers the waitlist offer.

### `reserveLargeTables`

True for `channel === 'online'`, false for staff. A walk-in couple should not be auto-seated on the eight-top at 7pm on a Saturday when the online channel is still selling four-tops. Staff can override anything manually; the algorithm should not need to be overridden often.

### Rules the engine does not decide

- **Never auto-reassign a reservation with `assignment_locked = 1`.** When a manager drags a booking to a table, set the flag. Their choice outranks the algorithm permanently.
- **Never move a `seated` reservation.** People are physically sitting there.
- Reassignment on modify: if `assignment_locked = 0` and the time or party size changed, clear tables and re-run. If locked and the new window conflicts, return a conflict to the UI and let the manager resolve it. Do not silently unlock.

### Optimiser (staff-triggered, never automatic)

`POST /service/day/optimise` — a dry-run that re-solves the unlocked reservations for a date, greedily by descending party size, and returns a proposed diff. The manager reviews and applies. **It never writes without a second explicit call.** An auto-optimiser that reshuffles the floor plan mid-service will lose you the client.

---

## 7. Floor plan

### The signature element

Most reservation software shows a grid of times. Ours opens on **the room**. The floor plan is the primary object, not a settings screen — it is the thing the product is remembered for and where the boldness is spent. Everything around it stays quiet.

Alongside it runs **the pacing ribbon**: a thin horizontal strip above the plan showing covers per 15 minutes across the shift, as filled bars against the pacing cap. It is both the read-out and the control — drag the top edge of a bucket to change `max_covers` for that interval. Managers currently do this in their heads; putting it on screen is the demo moment.

### Two modes, one canvas

| Mode | Purpose | Entered by |
|---|---|---|
| **Layout** | Build the room: add, move, resize, rotate, delete tables; define combinations | Settings → Floor plan, or a lock toggle |
| **Service** | Run the shift: see status, seat, finish, drag bookings between tables | Default |

Layout mode is deliberately harder to reach. Nobody should accidentally move table 12 at 8pm on a Friday.

### Layout mode

- SVG canvas, room tabs across the top, one canvas per room
- Drag from a shape palette to place; snap to a 10-unit grid
- Selected table shows resize handles and a rotate handle (15° steps)
- Right panel: label, seats min/max, shape, online bookable, assign priority, notes
- Multi-select with marquee; align and distribute for banks of tables
- Combinations built by selecting two or more tables → "Join as combination" → label and seat range
- Undo/redo, at least 20 steps deep
- Autosave off. Explicit **Save layout** button, `PUT /service/floor-plan`, whole-room payload. A dropped connection mid-drag must not persist a half-moved room.
- Duplicate room, so "Terrace" can start from "Main dining"

### Service mode

Table fill colour is status. This is the only place in the product where colour carries meaning alone, so each state also has a distinct badge shape for accessibility.

| State | Colour token | Badge |
|---|---|---|
| Free | `--svc-free` (panel surface, thin border) | none |
| Booked, upcoming | `--svc-upcoming` (accent outline) | clock |
| Arriving within 15 min | `--svc-due` (accent fill) | clock, filled |
| Seated, on time | `--svc-seated` (green fill) | person |
| Seated, over turn time | `--svc-over` (amber fill) | person, ring |
| Overdue arrival (15 min past) | `--svc-late` (coral fill) | exclamation |
| Blocked | `--svc-blocked` (muted, hatched) | slash |

Interactions:

- **Tap a table** → bottom sheet on iPad/iPhone, side drawer on desktop, with the booking and primary actions (Seat, Finish, No-show, Move, Add note)
- **Long-press a booking chip and drag to another table** → reassign, sets `assignment_locked = 1`, optimistic with rollback on conflict
- **Time scrubber** below the plan → drag to see the floor at any point in the shift. This is how a manager answers "can I fit a six-top at 8:30" without opening anything.
- **Tap empty table in service mode** → "Seat a walk-in here", pre-filled from the waitlist if the queue is non-empty

### Rendering rules

- SVG, not canvas — accessible, inspectable, and table labels stay crisp on retina iPads
- `viewBox` set to the room canvas dimensions; the client scales to fit, never stretches
- Pinch to zoom, two-finger pan, on touch; scroll-wheel zoom on desktop
- Minimum rendered table size 44×44 CSS px at default zoom
- `prefers-reduced-motion` respected: transitions drop to opacity only
- Re-render on SSE `reservation.*` events; no polling

---

## 8. Guest booking flow

The brief: **so easy you literally can't mess it up.** That is a specification, not a slogan. It means every screen has one decision, every dead end has an exit, and no state is unrecoverable.

### Route structure (Next.js, Vercel)

```
apps/web/src/app/
├── book/[slug]/page.tsx           # the booking flow
├── book/[slug]/book.css
├── manage/[token]/page.tsx        # manage an existing booking
└── waitlist/[token]/page.tsx      # live waitlist status
```

Served per venue at a subdomain resolving to `venue_settings.booking_slug`.

### Steps

One question per screen. Progress is a thin bar, not numbered steps — numbers imply length.

**1. Party size.** A row of tap targets 1–8, then "More than 8". Large party taps show `large_party_message` and the venue phone as a tap-to-call, plus a "Request a booking" form that creates a `staff` source reservation in `pending_payment`… no — creates a **waitlist entry** of kind `date_waitlist`, so no fake availability is implied.

**2. Date.** Horizontal strip of the next 14 days, each showing a fullness dot (plenty / limited / full / closed) from a single cheap aggregate call. Tapping "full" days is allowed and leads straight to the waitlist offer — never disable a day, explain it.

**3. Time.** Available slots only, grouped by service period with the period name as a quiet header. Times outside availability are simply absent. If zero slots: immediate inline waitlist offer plus the nearest two alternative dates that do have space. **Never show an empty screen.**

**4. Details.** Name, mobile, email. Three fields, nothing else required. Optional accordion: occasion, allergies, seating preference, notes for the venue. Marketing opt-in is unticked and separate from the booking action.

**5. Deposit (only if policy applies).** Stripe Payment Element inline. Clear statement of what is being taken and the cancellation window before the card field, not after.

**6. Confirmed.** Reference code, date, time, party size, venue address, add-to-calendar (.ics), a "Manage booking" link, and the venue phone. The magic link email and SMS go out immediately.

### The hold

On entering step 4, `POST /book/:slug/hold` locks the assigned tables for `hold_ttl_seconds` (default 600). The UI shows a quiet countdown only in the last 120 seconds — a timer running for ten minutes creates pressure and abandonment. On expiry: re-check availability, and if the slot is still free, silently re-hold and continue. Only interrupt the guest if it is genuinely gone, and then land them on step 3 with the nearest alternatives pre-selected.

### Anti-mistake rules (implement all)

1. **No dead ends.** Every failure state offers waitlist, alternative dates, or the phone number.
2. **Back is always safe.** Browser back moves one step and preserves entered data. State in URL query, not just memory.
3. **Nothing is destroyed silently.** Changing party size at step 3 re-queries and warns if the held time is lost, before it is lost.
4. **Phone input is forgiving.** Accept `07…`, `+44…`, spaces, dashes. Normalise to E.164 server-side with the existing `normalizeIdentifierValue`. Never reject with "invalid format" — parse it.
5. **Double-submit is impossible.** Client generates an `Idempotency-Key` UUID at step 4 entry and sends it on `reserve`. Server returns the same reservation for a repeat key. The button disables on tap and shows a spinner in place.
6. **Everything is one thumb away.** Primary action pinned bottom, full-width, ≥ 56px tall, within reach on a 6.7" phone.
7. **No account, ever.** Management is via signed magic link, valid 90 days or until the booking passes.
8. **Errors say what to do.** "That time just went. Here are the nearest three." Not "Error 409".

### Manage booking (`/manage/[token]`)

Shows the booking, and three actions: **Change**, **Cancel**, **Add a note**. Change re-enters the availability flow with the existing hold logic. Cancel confirms once, states the deposit consequence plainly if inside the window, and is irreversible. Token is single-purpose, scoped to one reservation, hashed at rest.

### Copy rules

Sentence case. Active voice. The button that says "Confirm booking" produces a screen that says "Booking confirmed". Never "Submit". Never "Oops". Venue voice, not app voice: "We'll hold this for 10 minutes" beats "Reservation held".

---

## 9. Waitlist

Two shapes, one table, two very different UIs.

### Walk-in queue (in-venue, the common case)

Staff-facing, iPad, three taps to add: party size, name, mobile. Quoted wait defaults from a simple estimate and is editable.

```typescript
export function estimateWait(
  partySize: number,
  queueAhead: WaitlistEntry[],
  occupancy: OccupancyRow[],
  now: Date
): number   // minutes, rounded to 5
```

Estimate = time until enough suitable tables free, based on `seated_at + turnMinutes` for parties currently seated, plus the queue ahead of them for the same size band. Round up to 5 minutes and add a 5-minute pad. **Under-promising is the correct bias**; a guest told 30 who waits 25 is delighted, told 20 who waits 25 is not.

Queue view: ordered list, position, party size, name, wait elapsed vs quoted (turning amber past quote), and per-row actions — **Notify**, **Seat**, **Remove**. Elapsed time is the emphasised number.

**Notify** sends SMS via Telnyx with a short link to `/waitlist/[token]`, sets `status = 'notified'`, `notify_expires_at = now + 10 min`, increments `notify_count`. On expiry the entry does not disappear — it flags amber for a staff decision. Automatically dropping someone who missed a text by ninety seconds is how a venue loses a customer.

**Seat** opens the floor plan in "choose a table" state, then creates a `walk_in` source reservation with `seated_at = now`, links `waitlist_entries.reservation_id`, sets `status = 'seated'`.

### Date waitlist (guest-facing, full dates)

Offered inline whenever availability returns zero slots, and from the "more than 8" path. Captures party size, date, acceptable time window, contact details. Guest gets a confirmation email stating plainly that this is **not a booking**.

**Promotion on cancellation.** When a reservation is cancelled or expires, enqueue a `waitlist_check` job:

1. Find `waiting` entries for that date whose window contains the freed slot and whose party size fits the freed capacity, ordered by `priority ASC, joined_at ASC`.
2. Take the first. Create a **hold** for the freed tables, TTL 30 minutes (longer than the guest flow — they are not at the keyboard).
3. Send email + SMS with a claim link. Set `status = 'notified'`, `notify_expires_at`.
4. On claim: convert to reservation, `source = 'waitlist'`, `status = 'converted'`, consume the hold.
5. On expiry: release the hold, set `status = 'expired'`, re-run for the next entry.

Only one entry is offered at a time. Offering to five people and taking the first response is a race that produces four disappointed guests.

### Waitlist status page (`/waitlist/[token]`)

Live position, current estimate, and one button: **I'm no longer waiting**. Polls every 30 seconds (not SSE — guests are on mobile data and may background the tab). Shows the venue phone.

---

## 10. Deposits and card on file

Stripe. New dependency — not currently in the stack.

### Policy resolution

```typescript
export function resolveDepositPolicy(
  policies: DepositPolicy[],
  ctx: { partySize: number; serviceDate: string; dayOfWeek: string; servicePeriodId: string }
): DepositPolicy | null;
```

Filter to active policies matching date range, day, period, and `min_party <= partySize`. Sort by `priority ASC`, take the first. No match → no deposit. Resolution happens **server-side at reserve time**, never trusted from the client.

### Modes

| Mode | Stripe object | Guest sees | Charged when |
|---|---|---|---|
| `none` | — | nothing | — |
| `card_on_file` | SetupIntent | "We'll hold your card. Nothing is charged unless you don't show." | Manual staff action after no-show |
| `deposit_fixed` | PaymentIntent | "£X deposit, redeemable against your bill" | Immediately |
| `deposit_per_person` | PaymentIntent, `amount × party` | "£X per person" | Immediately |

### Flow

1. `POST /book/:slug/reserve` with a valid hold → server resolves policy.
2. No deposit → create reservation `confirmed`, send confirmations, done.
3. Deposit required → create reservation `pending_payment`, create Stripe SetupIntent or PaymentIntent with `metadata.reservation_id`, insert `payments` row, return `client_secret`.
4. Client confirms via Stripe Payment Element.
5. **Webhook is the source of truth.** `payment_intent.succeeded` / `setup_intent.succeeded` → payment `succeeded`/`saved`, reservation → `confirmed`, send confirmations, emit `reservation.confirmed`.
6. Client-side success only shows an optimistic "Confirming…" state and polls `GET /book/manage/:token` for up to 20 seconds. It never writes the confirmed status itself.
7. Unpaid `pending_payment` reservations expire after 20 minutes via the cron sweeper → `status = 'expired'`, hold released, tables returned to inventory.

### Refunds and no-show charges

- Cancel inside the window with `deposit_*`: manager chooses refund or retain, per the policy default. Full or partial refund via `POST /service/reservations/:id/refund`.
- No-show with `card_on_file`: `POST /service/reservations/:id/charge-no-show`, amount from `no_show_fee_pence`, off-session PaymentIntent using the saved payment method. **Requires an explicit staff action with a confirm dialog showing the amount.** Never automatic — an automatic charge on a mis-tapped no-show is a chargeback and a one-star review.

### PCI and secrets

- Card data never touches the Worker. Payment Element only. Store `card_brand` and `card_last4` for display; nothing else.
- New secrets: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`. New public var: `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`.
- Verify every webhook with the Stripe signature header before parsing the body. Workers have no Node crypto — implement HMAC-SHA256 verification with WebCrypto, following the existing pattern in `workers/api/src/auth/telnyx-verify.ts`.
- `payment_events.stripe_event_id` is `UNIQUE` — insert first, and if it conflicts, the event is a replay. Ignore it. Stripe redelivers.
- Off-session charges require `setup_future_usage: 'off_session'` on the SetupIntent and a saved customer. Create a Stripe customer per `contact_id` and cache the id on the payment row.

---

## 11. Notifications

Extends Resend beyond magic links, and reuses Telnyx for SMS.

### Cron — must be added

**The audit found a `scheduled` handler with no cron trigger in `wrangler.toml`.** It has never run. Add:

```toml
[triggers]
crons = ["*/5 * * * *"]
```

The handler dispatches, in order, guarded so one failure does not block the rest:

1. `sweepExpiredHolds` — delete/mark holds past `expires_at`
2. `expirePendingPayments` — `pending_payment` older than 20 minutes → `expired` (no-op until Phase 8)
3. `dispatchDueNotifications` — see claim + send-time rules below
4. `expireWaitlistNotifications` — `notified` past `notify_expires_at` → flag or re-offer (no-op until Phase 7)
5. `markNoShows` — `confirmed` reservations 30+ minutes past start, still not seated → flag for staff (**flag, never auto-set `no_show`**)
6. `existing Wix refresh` — preserve current behaviour

### Dispatcher correctness

`dispatchDueNotifications` selects due rows (`status='scheduled' AND scheduled_for <= now`, limit 50), then for each:

1. **Claim atomically:** `UPDATE … SET status='sending', attempts=attempts+1 WHERE id=? AND status='scheduled'`. If `changes=0`, skip — another tick already owns it.
2. **Send-time status check:** re-read the linked reservation. If status is `cancelled` / `no_show` / `expired` (or otherwise not eligible for that template), mark the notification `skipped` and **do not call** Resend/Telnyx. Cancel-at-schedule-time is necessary; this check is what stops the embarrassing “see you tomorrow” after a cancel race or a stuck `sending` row.
3. **Send**, then `sent` + `provider_message_id`, or `failed` / re-queue with backoff. Recover stale `sending` rows (older than ~10 minutes) at the start of each tick so a killed Worker cannot leave permanent ghosts — and recovery must still pass the send-time check.
4. **Timezone:** `scheduled_for` is UTC. Reminder and quiet-hours math use the venue IANA timezone (`Europe/London` for UK pilots) so BST/GMT transitions do not shift local dinner times.

Full algorithm and required tests: [`GUEST-LOOP-BUILD-PLAN.md`](./GUEST-LOOP-BUILD-PLAN.md) §3a.

### Message set

| Template | Channel | Timing | Notes |
|---|---|---|---|
| `reservation_confirmed` | email + SMS | immediate | Includes reference and manage link |
| `reservation_pending_payment` | email | immediate | Only if deposit flow started but not completed |
| `reservation_reminder` | email | T−24h | Skipped if booking made inside 24h |
| `reservation_reminder_sms` | SMS | T−3h | The one that actually reduces no-shows |
| `reservation_changed` | email + SMS | immediate | On time/date/party change |
| `reservation_cancelled` | email | immediate | States refund outcome |
| `waitlist_joined` | email | immediate | Explicitly "this is not a booking" |
| `waitlist_table_ready` | SMS | on notify | Short. Link to status page |
| `waitlist_slot_offered` | email + SMS | on promotion | Claim link, expiry time stated |
| `post_visit_thanks` | email | T+18h after `finished` | Only if `marketing_opt_in` |

Reminders are **scheduled rows inserted at booking time**, not computed at send time. Cancel a booking → cancel its scheduled notifications (`status = 'cancelled'`). Change a booking → cancel and reschedule. This makes the queue auditable and makes "did the reminder go" answerable in one query.

### Idempotency

`notifications.idempotency_key` is `UNIQUE` and deterministic: `{reservation_id}:{template}:{channel}:{scheduled_for}`. Insert at schedule time. A duplicate insert throws and the second schedule is skipped — that prevents duplicate *rows*.

Duplicate *sends* under overlapping cron are a different failure mode. The claim transition `scheduled → sending` (above) is mandatory; the unique key alone is not enough once two ticks race the same due row.

### Email implementation

Current state is an inline HTML string in `workers/api/src/email/magic-link.ts`. Extend, don't replace:

```
workers/api/src/email/
├── send.ts              # generic Resend caller, retry, error surface
├── layout.ts            # shared shell: venue brand, logo, footer, address
└── templates/
    ├── reservation-confirmed.ts
    ├── reservation-reminder.ts
    ├── reservation-changed.ts
    ├── reservation-cancelled.ts
    ├── waitlist-joined.ts
    ├── waitlist-offered.ts
    └── post-visit.ts
```

Each template exports `{ subject, html, text }`. Plain text is required — do not skip it; a transactional email without a text part lands in spam more often.

Emails are branded per venue from `venue_settings.brand_json` (logo URL, accent colour, venue name). From address per deployment via `AUTH_FROM_EMAIL`; add `VENUE_FROM_EMAIL` and `VENUE_REPLY_TO` so replies reach the venue, not Phiof.

**Transactional messages carry no unsubscribe link. `post_visit_thanks` does, and honours it.** Getting this backwards is a UK GDPR/PECR problem, not a style issue.

### SMS

Reuse `sendTelnyxSms()` (port `workers/api/src/telnyx/send.ts` from `pdc-phiof` into the template — inbound verify already exists; outbound does not yet). Booking SMS does **not** go through Twilio. Constraints:

- 160 characters where possible. One segment. Every SMS states the venue name — a guest with no context does not know who "Your table is ready" is from.
- Include a short manage link. Use the reference code, not a long token, in the visible text.
- Never send SMS between 21:00 and 08:00 venue time except `waitlist_table_ready` (which is by definition during service). Queue the rest for 08:00.
- Guest replies land on the existing `/webhooks/telnyx` handler. **Route them to a service inbox, not the AI pipeline.** In Phase 8, an inbound message from a number matching an upcoming reservation creates a staff task, not an LLM reply.

---

## 12. Manager console

New web plugin `apps/web/src/plugins/service/`, registered in `apps/web/src/plugins/index.ts` per the existing compile-time pattern. Nav rail entry: **Service**.

### Screens

| View | Query | Purpose |
|---|---|---|
| **Today** | `?view=service` | Default. The shift at a glance |
| **Floor** | `?view=service&tab=floor` | Live floor plan |
| **Timeline** | `?view=service&tab=timeline` | Tables × time grid |
| **Waitlist** | `?view=service&tab=waitlist` | Queue |
| **Guests** | `?view=service&tab=guests` | Guest history, VIPs, no-show list |
| **Stats** | `?view=service&tab=stats` | Numbers |
| **Settings** | `?view=settings&tab=service` | Periods, floor plan editor, policies, notifications |

### Today view

The screen a manager leaves open all shift.

- **Header strip:** date picker, covers booked / capacity, walk-ins waiting, VIPs in tonight, unassigned count. Numbers large, labels small.
- **Pacing ribbon** across the top.
- **Reservation list:** grouped by time, each row showing time, party size, name, table, status, and a tag strip (allergy, birthday, VIP, first visit). Allergy tags are non-dismissable and high contrast.
- **Row actions on tap:** Seat, Finish, No-show, Move, Message guest.
- **Right drawer** on selection: full reservation detail, guest history, notes, payment status, event log.
- **Filters:** unassigned, deposits unpaid, allergies, VIP, large parties.

### Timeline view

Tables down the left, time across the top, reservations as blocks. Drag horizontally to change time, vertically to change table. Conflicts highlight on drag; drop is rejected with an explanation rather than silently corrected. This is the desktop power tool; the floor plan is the iPad tool.

### Guests view

Contacts with reservation history. Search by name, phone, email — all via `contact_identifiers`, which already dedupes across channels. Shows visit count, last visit, no-show count, allergies, notes, lifetime covers. `blocked = 1` guests are flagged at booking time in the staff flow and their online bookings are held for review rather than rejected outright.

### Responsive rules

| Breakpoint | Layout |
|---|---|
| ≥ 1280px | Three columns: nav rail, list, detail drawer. Timeline default |
| 768–1279px (iPad) | Two columns, detail as sheet. Floor plan default. Touch targets 44px+ |
| < 768px (iPhone) | Single column, bottom tab bar, detail full-screen. List default; floor plan pan/zoom |

The iPad breakpoint gets designed first — that is the device on the pass.

### Real-time

Reuse the existing SSE stream at `GET /events/stream`. New `domain_events` types:

```
reservation.created    reservation.updated    reservation.status_changed
reservation.assigned   waitlist.joined        waitlist.notified
waitlist.seated        waitlist.promoted      payment.succeeded
floorplan.updated
```

Every write path emits one. The audit is explicit that a missing emit means a stale dashboard, and in service a stale floor plan is worse than no floor plan.

---

## 13. Stats

Definitions matter more than charts. Every number below is computed from `reservations` with no derived counters, so a corrected status corrects the report.

| Metric | Definition |
|---|---|
| **Covers** | `SUM(party_size)` where status in (`seated`,`finished`) for the period. Booked covers is the same over (`confirmed`,`seated`,`finished`) |
| **Bookings** | Count of the same set |
| **No-show rate** | `no_show / (no_show + seated + finished)` — cancellations excluded from the denominator |
| **Cancellation rate** | `cancelled / (all non-expired)` |
| **Late cancellation rate** | `cancelled` where `cancelled_at > starts_at_utc - cancellation_window_hours` |
| **Average turn** | `AVG(finished_at - seated_at)` for `finished` with both stamps |
| **Table utilisation** | occupied table-minutes ÷ available table-minutes across open periods |
| **Seat utilisation** | covers ÷ theoretical seat-turns (sum of `seats_max` × turns available) |
| **Lead time** | median `starts_at_utc - created_at`, in hours |
| **Waitlist conversion** | `seated + converted` ÷ total entries |
| **Average wait** | `AVG(seated_at - joined_at)` for seated walk-ins |
| **Source mix** | count by `source` |
| **Deposit revenue** | `SUM(amount_pence)` where `status = 'succeeded'` and purpose `deposit` |
| **Repeat rate** | guests with ≥ 2 finished reservations ÷ distinct guests |

### Presentation

Four large numbers at the top — covers, utilisation, no-show rate, average wait — each with a period-over-period delta. Below: covers by day of week, covers by hour, source mix, and the no-show trend. Nothing else. A stats page that needs scrolling gets ignored.

Endpoint: `GET /service/stats?from=&to=&compare=previous`. Compute in SQL, one query per metric group, no client-side aggregation over raw rows.

---

## 14. API contract

### Public (no session) — must be added to the public-route allowlist in `workers/api/src/index.ts`

The global auth gate rejects unknown routes without a session. Adding a route without allowlisting it produces a 401 that looks like a bug.

| Method | Path | Body / Query | Returns |
|---|---|---|---|
| `GET` | `/book/:slug/venue` | — | Venue name, brand, address, phone, party bounds, periods summary |
| `GET` | `/book/:slug/days` | `from`, `to`, `party` | Per-date fullness: `plenty` \| `limited` \| `full` \| `closed` |
| `GET` | `/book/:slug/availability` | `date`, `party` | `AvailabilitySlot[]` (available only, for online channel) |
| `POST` | `/book/:slug/hold` | `date`, `time`, `party`, turnstile | `{ holdToken, expiresAt }` |
| `POST` | `/book/:slug/reserve` | hold token, guest details, `Idempotency-Key` | Reservation + `manageToken`, or `{ clientSecret }` if deposit |
| `POST` | `/book/:slug/waitlist` | party, date, window, details, turnstile | Waitlist entry + status token |
| `GET` | `/book/manage/:token` | — | Reservation summary, permitted actions |
| `POST` | `/book/manage/:token/cancel` | reason? | Updated reservation |
| `POST` | `/book/manage/:token/modify` | new hold token | Updated reservation |
| `GET` | `/book/waitlist/:token` | — | Position, estimate |
| `POST` | `/book/waitlist/:token/leave` | — | `{ ok: true }` |
| `POST` | `/webhooks/stripe` | Stripe event | `{ received: true }` |

### Staff (session required)

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/service/day` | `?date=` — reservations, waitlist, pacing, unassigned |
| `GET` | `/service/floor` | `?date=&at=` — rooms, tables, occupancy at a time |
| `GET` | `/service/availability` | **Requires** `channel=staff\|online`. Includes unavailable slots with reasons (staff typically needs them; online callers may filter client-side) |
| `POST` | `/service/reservations` | Create (phone, walk-in, staff) |
| `GET` | `/service/reservations/:id` | Detail + events + guest history |
| `PATCH` | `/service/reservations/:id` | Time, party, notes, tags |
| `POST` | `/service/reservations/:id/status` | `seat` \| `finish` \| `no_show` \| `cancel` \| `reinstate` |
| `PUT` | `/service/reservations/:id/tables` | Manual assignment, sets `assignment_locked` |
| `POST` | `/service/reservations/:id/refund` | Amount, reason |
| `POST` | `/service/reservations/:id/charge-no-show` | Explicit confirm required |
| `POST` | `/service/day/optimise` | Dry run, returns proposed diff |
| `POST` | `/service/day/optimise/apply` | Applies a returned diff by id |
| `GET` | `/service/waitlist` | Queue with computed positions |
| `POST` | `/service/waitlist` | Add entry |
| `PATCH` | `/service/waitlist/:id` | Edit |
| `POST` | `/service/waitlist/:id/notify` | Send ready SMS |
| `POST` | `/service/waitlist/:id/seat` | Convert to seated reservation |
| `DELETE` | `/service/waitlist/:id` | Remove with reason |
| `GET` | `/service/floor-plan` | Rooms + tables + combinations |
| `PUT` | `/service/floor-plan` | Whole-room save |
| `GET`/`PUT` | `/service/settings` | Venue settings |
| `GET`/`POST`/`PATCH`/`DELETE` | `/service/periods` | Service periods |
| `GET`/`POST`/`DELETE` | `/service/exceptions` | Closures and blocks |
| `GET`/`POST`/`PATCH` | `/service/deposit-policies` | Policies |
| `GET` | `/service/guests/:contactId` | History |
| `PATCH` | `/service/guests/:contactId` | VIP, allergies, notes, blocked |
| `GET` | `/service/stats` | Metrics |
| `GET` | `/service/notifications` | Delivery log |

### Conventions

- Existing envelope: success is the payload, errors are `{ error: string }` with an HTTP status. **Add** `{ error, code, details? }` for the new routes only — the guest UI needs machine-readable codes (`SLOT_TAKEN`, `HOLD_EXPIRED`, `PARTY_TOO_LARGE`, `PAYMENT_REQUIRED`, `POLICY_CLOSED`) to render the right recovery.
- `409 SLOT_TAKEN` returns `alternatives: AvailabilitySlot[]` in `details`. Never return a bare conflict.
- Idempotency on `POST /book/:slug/reserve` via header, stored on the reservation, 24-hour window.
- Zod schemas for every request and response body in `packages/shared-types/src/service.ts`, reused by the web client exactly as the existing API client does.

---

## 15. Design

### Two surfaces, deliberately different

The manager console and the guest booking page are not the same product wearing one skin, and making them match would damage both.

**Manager console — dark, inherits the existing "Soft Bubble" tokens.** It runs on an iPad on a pass in a dim room for six hours. Dark is functional, not fashionable. It also already exists and works; rebuilding it is wasted budget.

**Guest booking page — light, white-labelled per venue.** The guest is booking *Australasia*, not *Phiof*. A dark console-coloured booking page tells them they are using software. The page should feel like the venue's own site: venue accent, venue logo, generous space, big type. This is also the commercially correct answer — it is what makes the product resellable.

### Console tokens — extend, do not replace

The existing set in `apps/web/src/app/globals.css` stays exactly as it is. Append:

```css
:root {
  /* service state */
  --svc-free:      var(--panel-2);
  --svc-free-line: var(--border-strong);
  --svc-upcoming:  rgba(255, 107, 107, 0.18);
  --svc-due:       var(--accent);
  --svc-seated:    var(--green);
  --svc-seated-bg: var(--green-soft);
  --svc-over:      #F0B429;
  --svc-over-bg:   rgba(240, 180, 41, 0.16);
  --svc-late:      #FF6B6B;
  --svc-blocked:   rgba(130, 133, 142, 0.25);

  /* floor plan */
  --floor-bg:      #121317;
  --floor-grid:    rgba(255, 255, 255, 0.035);
  --floor-label:   var(--text-mid);
  --floor-select:  #7DD3FC;

  /* pacing ribbon */
  --pace-fill:     rgba(255, 107, 107, 0.55);
  --pace-cap:      var(--border-strong);
  --pace-over:     #F0B429;

  /* data type */
  --font-numeric: 'Plus Jakarta Sans', ui-monospace, monospace;
  --fs-metric:    34px;
  --fs-metric-sm: 22px;
}
```

`--svc-over` (amber) is the only genuinely new hue. Two accents and a warning colour is the whole palette; resist adding more.

**Numerals:** every time, cover count, and table label uses `font-variant-numeric: tabular-nums`. Digits that shift width while a countdown runs read as broken software.

### Guest page tokens — per venue, from `brand_json`

```css
:root {
  --v-bg:        #FFFFFF;
  --v-surface:   #F7F6F4;
  --v-ink:       #16161A;
  --v-ink-soft:  #5C5C66;
  --v-line:      rgba(0, 0, 0, 0.09);
  --v-accent:    /* venue brand colour */;
  --v-accent-ink:/* contrast-checked foreground */;
  --v-radius:    14px;
  --v-font-display: /* venue display face, default 'Plus Jakarta Sans' */;
  --v-font-body:    'Plus Jakarta Sans', system-ui, sans-serif;
}
```

`brand_json` supplies accent, logo URL, display font, and radius. Compute accent contrast at render and pick foreground automatically — venue owners will supply a pale yellow and you must not ship unreadable buttons. Fall back to the venue name set in the display face when no logo exists.

**Type scale on the guest page is one step larger than a normal web app.** Party size options at 20px, times at 18px, primary action at 17px semibold. This is used at night, on a phone, often not entirely sober. Small type is the enemy.

### Motion

One orchestrated moment, everywhere else quiet:

- Slot grid appears with a 20ms stagger on load. Nothing else animates on that screen.
- Floor plan table status changes cross-fade over 180ms. Movement is instant during drag; only colour animates.
- The pacing ribbon fills left to right once on load, 400ms, then never again.
- `prefers-reduced-motion: reduce` drops all of the above to instant.

No skeleton shimmer. Loading states are a quiet label: "Checking availability".

### Quality floor (non-negotiable)

Visible keyboard focus on every interactive element. Full keyboard navigation of the booking flow. Semantic buttons, never divs. Every floor-plan table has an accessible name and status in text. Colour is never the only status signal. Contrast ≥ 4.5:1 for text, ≥ 3:1 for UI boundaries. Works at 320px wide.

---

## 16. Security

Address these as they are built, not as a hardening pass afterwards.

### Public endpoint protection (the audit's largest gap)

`POST /leads/intake` currently has no auth, no rate limit, no bot protection. Do not repeat that.

- **Turnstile** on `hold`, `reserve`, and `waitlist`. New secret `TURNSTILE_SECRET_KEY`, public `NEXT_PUBLIC_TURNSTILE_SITE_KEY`. Verify server-side before any write.
- **Rate limits** via the existing `RATE_LIMITS` KV: 10 availability reads/min/IP, 5 holds/min/IP, 3 reserves/min/IP, 20/hour/IP across all booking writes. The audit notes a known race in the KV counter — acceptable for rate limiting, where approximate is fine. Do not reuse that pattern for anything requiring correctness.
- **Per-venue caps** as a second layer: max 50 online bookings/hour/venue. A distributed bot passing IP limits still hits this.
- Reject requests where `booking_slug` does not resolve, with a generic 404. Do not confirm which slugs exist.

### Guest tokens

- 32 bytes from `crypto.getRandomValues`, base64url, **SHA-256 hashed at rest** — same approach as `staff_sessions.token_hash`.
- Scoped to one reservation and one purpose. A `manage_reservation` token cannot read anything else.
- Expiry: booking start + 7 days, or 90 days, whichever is sooner. Revoked on cancellation.
- Rate limited per token: 30 requests/hour.
- **Never a staff session.** Guest tokens must not create rows in `staff_sessions` or `staff_users`. Keep the code paths separate so a future change to staff auth cannot accidentally grant guest access to the console.

### The admin secret bypass

`adminSecretAuthorized()` grants full API access on `X-Admin-Secret` for **every** route. That is acceptable for seed scripts on a demo Worker; it is not acceptable when the same header can charge a card or export a guest list.

Required change: the bypass allowlist becomes explicit. `X-Admin-Secret` is valid only for `/admin/*`. All `/service/*` and `/book/*` routes require a real session or a guest token. Implement this in Phase 1, before any of it goes near a real venue.

### Authorisation

Every `/service/*` route enforces `organization_id` scoping via `env.ORGANIZATION_ID` on every query — the existing pattern, applied without exception. Add role checks:

| Action | Minimum role |
|---|---|
| View day, floor, waitlist | `member` |
| Create, modify, seat, cancel | `member` |
| Refund, charge no-show | `admin` |
| Edit floor plan, periods, deposit policies | `admin` |
| Block a guest | `admin` |
| Export guest data | `admin` |

Enforce in the route handler using the existing `canManageTeam`-style helpers; add `canManageMoney(role)` and `canManageVenue(role)` to `workers/api/src/auth/constants.ts`.

### Headers

Add a CSP to the Next.js config — currently absent. The booking page loads Stripe and Turnstile:

```
default-src 'self';
script-src 'self' https://js.stripe.com https://challenges.cloudflare.com;
frame-src https://js.stripe.com https://challenges.cloudflare.com;
connect-src 'self' https://api.stripe.com <worker-origin>;
img-src 'self' data: https:;
style-src 'self' 'unsafe-inline';
```

Plus `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY` on the console.

`CORS_ORIGIN` gains the venue booking subdomain. Do not use `*` — the endpoints accept credentials.

### Data protection (UK GDPR)

The venue is the controller, Phiof the processor. Practical requirements:

- **Retention:** guest contact details on reservations older than 24 months are anonymised by a scheduled job — name to "Former guest", phone/email nulled, `contact_id` unlinked. Aggregate stats survive because they are computed on `party_size` and status, not identity. Make the window a venue setting.
- **Erasure:** `POST /service/guests/:contactId/erase` — anonymises reservations, deletes the contact, identifiers, notes, and guest profile. Logs the erasure to `staff_activity_log` without the erased data.
- **Export:** `GET /service/guests/:contactId/export` returns JSON of everything held.
- **Allergy data is health data.** Store it, show it to staff, and exclude it from exports to third parties and from any future marketing surface. Never put it in an SMS.
- Marketing consent is separate from booking, unticked, timestamped in `guest_profiles.marketing_opt_in_at`.
- A processor agreement and privacy notice link belong on the booking page footer, per venue.

### Operational

- Stripe and Telnyx webhooks: verify signatures before parsing. Reject unsigned in production with no exception flag. (`TWILIO_SKIP_SIGNATURE_VALIDATION` exists for dev — do not add an equivalent for Stripe.)
- Log reservation mutations to `reservation_events` with actor. Money actions additionally to `staff_activity_log`.
- Never log full guest contact details or card metadata. The existing JSON logger takes a message and org; keep PII out of it.

---

## 17. Feature flags

Add to `wrangler.toml` `[vars]` and expose through `workers/api/src/capabilities.ts` and `GET /admin/capabilities`, following the existing pattern exactly:

| Flag | Default | Gates |
|---|---|---|
| `ENABLE_SERVICE` | `"true"` | Whole module. Off = routes 404, nav entry hidden |
| `ENABLE_RESERVATIONS` | `"true"` | Booking flow and reservation routes |
| `ENABLE_WAITLIST` | `"true"` | Waitlist UI and routes |
| `ENABLE_DEPOSITS` | `"false"` | Stripe paths. Off = policy resolution always returns null |
| `ENABLE_FLOOR_PLAN` | `"true"` | Floor plan views. Off = list and timeline only |
| `ENABLE_AUTO_ASSIGN` | `"true"` | Auto assignment. Off = all bookings land unassigned |

`ENABLE_DEPOSITS` defaults off so a venue can go live before Stripe onboarding completes. `ENABLE_AUTO_ASSIGN` off is a legitimate operating mode — some managers assign everything by hand and will trust the system faster if they can start that way.

---

## 18. Testing

Vitest, `workers/api`, matching the existing 13-file suite. **No `vitest.config.*` exists — add one** in Phase 1 with `environment: 'node'` and coverage reporting.

### Required unit tests

`availability.test.ts`
- Slots generated at correct interval across period boundaries
- Last seating respected; turn time may exceed close within grace
- Closed-day exception returns all slots unavailable with `closed`
- `special_hours` overrides period times
- Blocked table removes only that table's capacity
- Party outside online bounds returns `party_too_large`, staff channel does not
- Lead time and advance window boundaries, exact-minute cases
- Pacing cap blocks a slot with tables still free
- Adjacent bookings do not conflict (19:00 end, 19:00 start)
- Turn rule specificity: period rule beats venue rule beats default

`assignment.test.ts`
- Tightest fit wins
- Single table always preferred over a combination
- Two-table combination preferred over three
- `reserveLargeTables` keeps the 8-top free for online, releases it for staff
- Room preference respected when a same-score alternative exists
- Deterministic tie-break by label
- Returns null when nothing fits
- Never returns an inactive or non-`online_bookable` table on the online channel

`holds.test.ts`
- Concurrent reserve on the same slot: one succeeds, one gets `SLOT_TAKEN`
- Expired hold does not block
- Consumed hold does not block
- Hold released on payment expiry

`waitlist.test.ts`
- Position ordering by priority then join time
- Promotion picks exactly one entry
- Party size and window filtering on promotion
- Expired notification re-offers to the next entry
- Wait estimate monotonic in queue length

`notifications.test.ts`
- Idempotency key blocks a duplicate insert
- Reminder cancelled when reservation cancelled
- Reminder rescheduled on time change
- Quiet hours defer non-urgent SMS
- Booking made inside 24h skips the 24h reminder

`deposits.test.ts`
- Policy resolution by priority, party, day, and period
- `deposit_per_person` multiplies correctly
- Webhook replay is ignored via `stripe_event_id`
- Reservation stays `pending_payment` until webhook

`stats.test.ts`
- No-show rate excludes cancellations from the denominator
- Covers count only seated and finished
- Utilisation across a period with a blocked table

### Concurrency test (the one that matters)

The single most important correctness property: **two guests must never book the same table for overlapping times.** Write an integration test firing 20 parallel `reserve` calls at one slot with one suitable table, asserting exactly one 200 and nineteen 409s.

The mechanism that makes this work: the hold insert is a **conditional insert in one statement**, so D1 evaluates the conflict check and the write atomically.

```sql
INSERT INTO reservation_holds (id, organization_id, location_id, service_date,
                               start_time, end_time, party_size, client_token_hash,
                               expires_at, created_at)
SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, datetime('now')
WHERE NOT EXISTS (
  SELECT 1 FROM reservation_tables rt
  JOIN reservations r ON r.id = rt.reservation_id
  WHERE rt.table_id IN (SELECT value FROM json_each(?10))
    AND r.location_id = ?3 AND r.service_date = ?4
    AND r.status IN ('pending_payment','confirmed','seated')
    AND NOT (r.end_time <= ?5 OR r.start_time >= ?6)
)
AND NOT EXISTS (
  SELECT 1 FROM reservation_hold_tables ht
  JOIN reservation_holds h ON h.id = ht.hold_id
  WHERE ht.table_id IN (SELECT value FROM json_each(?10))
    AND h.location_id = ?3 AND h.service_date = ?4
    AND h.consumed_at IS NULL AND h.expires_at > datetime('now')
    AND NOT (h.end_time <= ?5 OR h.start_time >= ?6)
);
```

Then check `meta.changes === 1`. Zero means someone won the race — return `409 SLOT_TAKEN` with alternatives. Insert the `reservation_hold_tables` rows in the same `env.DB.batch()` call.

D1 is single-primary SQLite, so serialised writes give correct behaviour here. Durable Objects are the upgrade path only if a venue ever runs a ticketed drop with thousands of simultaneous attempts; the schema does not change if you migrate.

### Manual QA per phase

Real devices, not simulators: iPhone (Safari), iPad (Safari, landscape), desktop Chrome. Test the booking flow on 3G throttling. Test the floor plan with 60+ tables. Test a full service day with 80 reservations for render performance.

---

## 19. Build order

Do not skip gates. Each phase ends with `pnpm test` green, the migration applied locally, and the manual checks passing.

### Phase 0 — Repo prep
New Worker, new D1, flags set, `vitest.config.ts` added, admin-secret bypass scoped to `/admin/*`.
**Gate:** health check green on the new Worker, existing tests pass.

### Phase 1 — Service core
Migrations 0034–0035. `plugins/service/` with venue settings, rooms, tables, combinations, periods, turn rules, pacing, exceptions. Routes `/service/settings`, `/service/floor-plan`, `/service/periods`, `/service/exceptions`. Seed script for a realistic venue: 3 rooms, 28 tables, lunch and dinner periods, turn rules.
**Gate:** floor plan reads back exactly as saved. Schema version 0035.

### Phase 2 — Floor plan editor
Web plugin registered, layout mode, drag/resize/rotate, combinations UI, room tabs, save.
**Gate:** a 28-table room built from scratch on an iPad in under 10 minutes.
**Gate status:** passed (2026-08-05) — Joachim signed off after iPad check; proceed to Phase 3.

### Phase 3 — Availability and assignment
Migration 0036. Pure engines, fully unit tested, before any UI. `GET /service/availability`, `POST /service/reservations`, status transitions, hold mechanics with the conditional insert.
**Gate:** the full availability and assignment test suites pass, including the 20-way concurrency test. This is the phase to spend Fable on.
**Gate status:** passed — engines + concurrency suites green on `main` (schema 0036).

### Phase 4 — Manager console
Today view, floor service mode, timeline, reservation drawer, pacing ribbon, SSE wiring.
**Gate:** a manager can take a phone booking, assign it, seat it, and finish it without touching a settings screen.
**Gate status:** merged to `main` (2026-08-05) via `feat/service-console`. Layout mode sits behind an explicit toggle; console is the default Service view.

### Phase 5 + 6 — Guest booking + notifications (one deliverable)

Do **not** ship Phase 5 without Phase 6. A booking that creates a row but never emails or texts looks broken to a GM. Treat the closed loop as the unit of work:

> Guest books → confirmation email/SMS lands → reminder is scheduled → manager sees the booking appear live on the floor plan.

That loop is the sales demo and the first thing a venue can actually run.

**Implementation plan (source of truth for this deliverable):** [`GUEST-LOOP-BUILD-PLAN.md`](./GUEST-LOOP-BUILD-PLAN.md)

**Phase 5 scope:** public routes, allowlist, Turnstile, rate limits, the six-step flow (deposit step deferred to Phase 8), manage page, guest tokens. Every availability call must pass `channel=online` (the param is required server-side — see §20).

**Phase 6 scope:** migration **0037**, cron trigger, dispatcher (claim + send-time reservation check + BST-safe scheduling), confirmation + reminder email/SMS templates via Resend + **Telnyx**, scheduling and cancellation of scheduled rows.

**Combined gate:**
1. Anti-mistake list in §8 verified item by item on a real phone (book, change, and cancel). Soft waitlist exits (call venue) until Phase 7.
2. Book → confirmation lands in under 30 seconds.
3. Reminder visible as a scheduled row with the correct send time; cancel removes it; a forced dispatcher tick after cancel sends nothing for that booking.
4. New booking appears on the manager console floor/today view without a manual refresh (SSE).

Suggested model: Opus 5 for the guest UI and templates; Fable 5 for the cron dispatcher claim path and hold/idempotency edges.

### Phase 7 — Waitlist
Migration **0038**, queue, estimate, notify, seat, date waitlist, promotion on cancellation.
**Gate:** cancel a booking on a full date and watch exactly one waitlisted guest receive an offer.

### Phase 8 — Deposits, stats, AI hook
Migration **0039** and **0040**. Stripe end to end. Stats endpoints and view. The single narrow hook into `ai/pipeline.ts`: an inbound SMS from a number matching an upcoming reservation creates a staff task instead of an LLM reply.
**Gate:** a deposit booking completes via webhook, not client optimism. Stats reconcile against hand-counted seed data.

### Phase 9 — Venue pilot
Seed one design-partner venue's real floor plan and periods. Run a shadow service: staff enter real bookings alongside their existing system for one week. Compare at the end of the week.
**Gate:** a shift run entirely in the product without falling back to paper.

---

## 20. Decisions taken, and what would change them

Recorded so a future session does not silently reverse them.

| Decision | Reason | Revisit when |
|---|---|---|
| D1 conditional insert, no Durable Objects | Restaurant-scale concurrency is low; DO adds a binding and a deployment concept for no current benefit | Ticketed events or a venue with thousands of simultaneous bookers |
| Reuse `contacts` + `contact_identifiers` | One guest history across enquiries and bookings; dedupe already solved | Never — this is load-bearing |
| Reservations never create `leads` rows | `leads` has `UNIQUE(organization_id, phone)`; shared phones are normal | Never |
| Slots derived, never stored | Stored slots rot the moment periods or turn times change | Never |
| Waitlist position computed, not stored | Goes stale on every insert and removal | Never |
| Guest magic links, no accounts | Accounts are the largest single drop-off in booking funnels | A loyalty programme, and even then keep booking accountless |
| Manager console dark, guest page light per venue | Different rooms, different lighting, different owner of the brand | Never |
| One venue, multi-venue-ready schema | Every table already carries `location_id`; only the UI is missing | The first multi-site client signs |
| Deposits off by default | Venues go live before Stripe onboarding finishes | Per venue, in settings |
| No auto-optimise, no auto no-show, no auto-drop from waitlist | Every automatic action that can embarrass a venue in front of a guest must be a human decision | Never |

### Known gaps this build does not close

- No CI. The 13-file suite grows to ~40 here and still runs only when someone types `pnpm test`. Add a GitHub Action running `pnpm test` and `pnpm build` on PR — half a day, and it protects everything above.
- No staging environment. Migrations go from local to production. With money and guest data now in scope, a staging Worker and D1 is no longer optional.
- No error tracking. `/health` and JSON logs are not enough once a real venue is live during service. Add Workers Observability or Sentry before Phase 9.
- The console opens a second `EventSource` on `/events/stream` alongside the inbox's own, doubling the 800ms poll against `domain_events` for any user with both open. Browsers allow six connections per origin so it works, but a shared multiplexer would have to live in core inbox code, which the plugin registry convention forbids a plugin from editing. Left as is deliberately; revisit when a third plugin needs a stream, at which point the multiplexer belongs in core next to the existing subscription rather than in any one plugin.
- `GET /service/availability` **requires** `channel=staff` or `channel=online` (400 `CHANNEL_REQUIRED` if omitted or invalid). Closed 2026-08-05 — the previous silent `staff` default would have let a guest caller sell staff-only inventory and ignore online party bounds. The console already passes `channel=staff`; Phase 5 public routes must pass `channel=online` at every call site. Do not reintroduce a default.
- The concurrency guarantee is proven only within a single Miniflare instance. `holds-concurrency.test.ts` and `reservations-concurrency.test.ts` fire 20 parallel reserves at one table and assert one winner, but both run in one isolate against one local D1. The property they demonstrate — that the conditional `INSERT … WHERE NOT EXISTS` cannot be split between check and write — carries to production only because D1 serialises every write through a single primary. That is a documented property of the platform, not something this suite has observed. Before the pilot, run a real multi-region load test against a deployed Worker: concurrent reserves from at least two colos at one slot, asserting one 201 and one reservation row. If it ever fails, the schema does not change — the fix is a Durable Object per location fronting the hold insert.
- Floor plan saves are last-write-wins. `PUT /service/floor-plan` submits the whole plan and has no concurrency check, so two managers editing layouts at once will silently overwrite each other — the second save wins entirely, and the first manager sees no indication their work was discarded. Closing it needs a version column on `rooms`, returned by `GET /service/floor-plan` and checked against `If-Match` on `PUT`, rejecting stale saves with `409`. Low priority: it takes two managers editing layouts simultaneously, which is rare outside initial setup. Revisit if a multi-manager venue reports a layout reverting.

---

## Appendix A — File map

```
workers/api/
├── migrations/
│   ├── 0034_service_core.sql
│   ├── 0035_service_periods.sql
│   ├── 0036_reservations.sql
│   ├── 0037_notifications.sql
│   ├── 0038_waitlist.sql
│   ├── 0039_payments.sql
│   └── 0040_guest_profiles.sql
├── src/
│   ├── plugins/service/
│   │   ├── db/            venue.ts rooms.ts tables.ts periods.ts
│   │   │                  reservations.ts holds.ts waitlist.ts
│   │   │                  guests.ts payments.ts
│   │   ├── availability.ts
│   │   ├── assignment.ts
│   │   ├── holds.ts
│   │   ├── waitlist-estimate.ts
│   │   ├── promotion.ts
│   │   ├── deposits.ts
│   │   ├── stats.ts
│   │   ├── reference.ts
│   │   ├── time.ts          (venue-local date/time, DST-safe; reuse lib/uk-dates.ts)
│   │   └── types.ts
│   ├── routes/
│   │   ├── service.ts
│   │   ├── book.ts
│   │   └── stripe-webhook.ts
│   ├── email/
│   │   ├── send.ts layout.ts templates/*.ts
│   ├── notifications/
│   │   ├── schedule.ts dispatch.ts sms.ts
│   └── cron/
│       └── dispatcher.ts

apps/web/src/
├── plugins/service/
│   ├── index.tsx                    registerPlugin + registerSettingsSection
│   ├── ServiceWorkspace.tsx
│   ├── today/  floor/  timeline/  waitlist/  guests/  stats/  settings/
│   └── components/  FloorCanvas.tsx  TableShape.tsx  PacingRibbon.tsx
│                    ReservationDrawer.tsx  TimeScrubber.tsx  StatusPill.tsx
├── app/book/[slug]/       guest booking flow
├── app/manage/[token]/    manage a booking
├── app/waitlist/[token]/  live waitlist status
└── lib/api/service.ts     typed client

packages/shared-types/src/service.ts   all Zod schemas
```

## Appendix B — Shared constants

```typescript
export const OCCUPYING_STATUSES = ['pending_payment', 'confirmed', 'seated'] as const;
export const ACTIVE_STATUSES    = [...OCCUPYING_STATUSES, 'finished'] as const;
export const DAYS = ['mon','tue','wed','thu','fri','sat','sun'] as const;
export const REFERENCE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford
export const DEFAULT_TURN_RULES = [
  { partyMin: 1,  partyMax: 2,  turnMinutes: 90  },
  { partyMin: 3,  partyMax: 4,  turnMinutes: 105 },
  { partyMin: 5,  partyMax: 6,  turnMinutes: 120 },
  { partyMin: 7,  partyMax: 10, turnMinutes: 150 },
  { partyMin: 11, partyMax: 99, turnMinutes: 180 },
];
export const HOLD_TTL_SECONDS = 600;
export const PROMOTION_HOLD_TTL_SECONDS = 1800;
export const PENDING_PAYMENT_TTL_MINUTES = 20;
export const NO_SHOW_FLAG_MINUTES = 30;
```

## Appendix C — Time handling

Every venue-local time is a `YYYY-MM-DD` date plus an `HH:MM` string. `starts_at_utc` exists only for ordering and reminder scheduling.

Rules:
- Never derive a local time by formatting a UTC timestamp. On 26 October the clocks go back and a 23-hour day will silently produce an off-by-one service.
- A service period crossing midnight (a late bar) is stored with `end_time` > "24:00" as `"25:30"`, not as the next day. Slot generation handles the overflow; date attribution stays on the opening day, which is how venues count a shift.
- Reuse and extend `workers/api/src/lib/uk-dates.ts`. Do not add a date library.
- Reminder scheduling computes `starts_at_utc - offset` and stores an ISO string. Recompute on any time change.