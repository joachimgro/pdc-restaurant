#!/usr/bin/env node
/**
 * Seed a realistic venue for the service module: 3 rooms, 28 tables, lunch
 * and dinner periods across the week, and the default turn time rules.
 *
 * Re-runnable. Every row has a deterministic id and is written with
 * INSERT OR REPLACE, so running this twice produces 28 tables, not 56.
 *
 * Usage (from repo root):
 *   node scripts/seed-venue-demo.mjs --local
 *   node scripts/seed-venue-demo.mjs            # --remote
 *   node scripts/seed-venue-demo.mjs --local --print   # dump SQL, do not run
 *   node scripts/seed-venue-demo.mjs --local --config=workers/api/wrangler.dev.toml
 *
 * ORGANIZATION_ID and database_name are read from the wrangler config, so the
 * seed always lands in the same tenant the Worker serves. On the template repo
 * those are still CHANGE_ME — point --config at a configured file.
 *
 * Requires migrations 0034 and 0035 to be applied first:
 *   cd workers/api && pnpm db:migrate:local
 */
import { readFileSync, writeFileSync, unlinkSync, mkdtempSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const WRANGLER_DIR = join(ROOT, "workers", "api");

const local = process.argv.includes("--local");
const printOnly = process.argv.includes("--print");

const configArg = process.argv.find((a) => a.startsWith("--config="));
const WRANGLER_TOML = configArg
  ? join(ROOT, configArg.slice("--config=".length))
  : join(WRANGLER_DIR, "wrangler.toml");

function readToml(key) {
  const source = readFileSync(WRANGLER_TOML, "utf8");
  const match = source.match(new RegExp(`^\\s*${key}\\s*=\\s*"([^"]+)"`, "m"));
  return match ? match[1] : null;
}

const ORG_ID = readToml("ORGANIZATION_ID");
const DB_NAME = readToml("database_name");

if (!ORG_ID || ORG_ID === "CHANGE_ME") {
  console.error(
    `ORGANIZATION_ID is not set in ${WRANGLER_TOML}.\n` +
      "Configure the deployment before seeding — every row is scoped to it,\n" +
      "or pass --config=<path> pointing at a configured wrangler file."
  );
  process.exit(1);
}
if (!DB_NAME || DB_NAME === "pdc-CHANGE_ME-db") {
  console.error(`database_name is not set in ${WRANGLER_TOML}.`);
  process.exit(1);
}

const LOCATION_ID = "venue-main";
const VENUE_NAME = "The Test Kitchen";
const TIMEZONE = "Europe/London";

function q(value) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "1" : "0";
  return `'${String(value).replace(/'/g, "''")}'`;
}

// ── Rooms ───────────────────────────────────────────────────────────────────

const ROOMS = [
  {
    id: "room-main",
    name: "Main Dining",
    accent: "#FF6B6B",
    online: true,
    w: 1200,
    h: 800,
    sort: 0,
  },
  {
    id: "room-bar",
    name: "Bar",
    accent: "#F0B429",
    online: true,
    w: 900,
    h: 600,
    sort: 1,
  },
  {
    id: "room-terrace",
    name: "Terrace",
    accent: "#34D399",
    online: true,
    w: 900,
    h: 600,
    sort: 2,
  },
];

/**
 * 28 tables. Positions are snapped to the 10-unit grid and laid out as a
 * manager would recognise: banquettes down the left wall, rounds through the
 * middle, high tops along the bar, and loose two-tops on the terrace.
 */
const TABLES = [
  // Main Dining — 14 covers-heavy tables
  ["1", "room-main", 2, 2, "banquette", 80, 80, 100, 70, 0, 90],
  ["2", "room-main", 2, 2, "banquette", 80, 180, 100, 70, 0, 90],
  ["3", "room-main", 2, 4, "banquette", 80, 280, 100, 90, 0, 95],
  ["4", "room-main", 2, 4, "banquette", 80, 400, 100, 90, 0, 95],
  ["5", "room-main", 4, 4, "square", 280, 100, 110, 110, 0, 100],
  ["6", "room-main", 4, 4, "square", 280, 260, 110, 110, 0, 100],
  ["7", "room-main", 4, 4, "square", 280, 420, 110, 110, 0, 100],
  ["8", "room-main", 2, 4, "round", 480, 120, 100, 100, 0, 105],
  ["9", "room-main", 2, 4, "round", 480, 300, 100, 100, 0, 105],
  ["10", "room-main", 4, 6, "round", 480, 480, 130, 130, 0, 110],
  ["11", "room-main", 4, 6, "round", 680, 140, 130, 130, 0, 110],
  ["12", "room-main", 4, 6, "round", 680, 340, 130, 130, 0, 110],
  ["14", "room-main", 6, 8, "rect", 880, 120, 200, 110, 0, 140],
  ["15", "room-main", 8, 10, "rect", 880, 320, 220, 120, 0, 160],

  // Bar — 8 quick-turn perches
  ["B1", "room-bar", 1, 2, "bar_stool", 60, 80, 60, 60, 0, 60],
  ["B2", "room-bar", 1, 2, "bar_stool", 150, 80, 60, 60, 0, 60],
  ["B3", "room-bar", 1, 2, "bar_stool", 240, 80, 60, 60, 0, 60],
  ["B4", "room-bar", 1, 2, "bar_stool", 330, 80, 60, 60, 0, 60],
  ["B5", "room-bar", 2, 4, "high_top", 120, 250, 100, 100, 0, 80],
  ["B6", "room-bar", 2, 4, "high_top", 300, 250, 100, 100, 0, 80],
  ["B7", "room-bar", 4, 6, "sofa", 500, 200, 180, 90, 0, 120],
  ["B8", "room-bar", 4, 6, "sofa", 500, 380, 180, 90, 0, 120],

  // Terrace — 6 weather-dependent tables
  ["T1", "room-terrace", 2, 2, "round", 80, 100, 90, 90, 0, 130],
  ["T2", "room-terrace", 2, 2, "round", 240, 100, 90, 90, 0, 130],
  ["T3", "room-terrace", 2, 4, "square", 400, 100, 100, 100, 0, 130],
  ["T4", "room-terrace", 2, 4, "square", 560, 100, 100, 100, 0, 130],
  ["T5", "room-terrace", 4, 6, "rect", 160, 320, 180, 100, 0, 135],
  ["T6", "room-terrace", 4, 6, "rect", 440, 320, 180, 100, 0, 135],
];

// Table 13 is deliberately absent — venues skip it, and a seed that pretends
// otherwise looks synthetic in a demo.

const COMBINATIONS = [
  {
    id: "combo-5-6",
    label: "5+6",
    min: 6,
    max: 8,
    members: ["tbl-5", "tbl-6"],
    priority: 300,
  },
  {
    id: "combo-11-12",
    label: "11+12",
    min: 8,
    max: 12,
    members: ["tbl-11", "tbl-12"],
    priority: 310,
  },
  {
    id: "combo-14-15",
    label: "14+15",
    min: 12,
    max: 18,
    members: ["tbl-14", "tbl-15"],
    priority: 320,
  },
];

// ── Service periods ─────────────────────────────────────────────────────────

const LUNCH_DAYS = ["wed", "thu", "fri", "sat", "sun"];
const DINNER_DAYS = ["tue", "wed", "thu", "fri", "sat"];

const PERIODS = [];
for (const day of LUNCH_DAYS) {
  PERIODS.push({
    id: `period-lunch-${day}`,
    name: "Lunch",
    day,
    start: "12:00",
    end: "15:00",
    lastSeating: "14:15",
    interval: 15,
    sort: 0,
    rooms: ["room-main", "room-terrace"],
  });
}
for (const day of DINNER_DAYS) {
  // The kitchen runs later at the weekend.
  const late = day === "fri" || day === "sat";
  PERIODS.push({
    id: `period-dinner-${day}`,
    name: "Dinner",
    day,
    start: "17:30",
    end: late ? "22:30" : "22:00",
    lastSeating: late ? "21:30" : "21:00",
    interval: 15,
    sort: 1,
    rooms: ["room-main", "room-bar", "room-terrace"],
  });
}

/**
 * Spec Appendix B. Duplicated from DEFAULT_TURN_RULES in
 * packages/shared-types/src/service.ts because this is a plain node script
 * with no build step for workspace TypeScript — keep the two in step.
 */
const TURN_RULES = [
  [1, 2, 90],
  [3, 4, 105],
  [5, 6, 120],
  [7, 10, 150],
  [11, 99, 180],
];

// Protect the kitchen from a wall of simultaneous orders on the busiest nights.
const PACING_RULES = [
  { period: "period-dinner-fri", interval: 15, covers: 24, from: "18:30", to: "21:00" },
  { period: "period-dinner-sat", interval: 15, covers: 24, from: "18:30", to: "21:00" },
];

// ── SQL ─────────────────────────────────────────────────────────────────────

const statements = [];

statements.push(
  `INSERT OR IGNORE INTO organizations (id, name) VALUES (${q(ORG_ID)}, ${q(
    "Venue Demo"
  )});`
);
statements.push(
  `INSERT OR IGNORE INTO locations (id, organization_id, name, abbrev)
VALUES (${q(LOCATION_ID)}, ${q(ORG_ID)}, ${q(VENUE_NAME)}, ${q("TTK")});`
);

statements.push(
  `INSERT OR REPLACE INTO venue_settings (
  location_id, organization_id, timezone, booking_slug, slot_interval_min,
  default_turn_minutes, grace_after_close_min, min_party_online, max_party_online,
  large_party_message, min_lead_minutes, max_advance_days, hold_ttl_seconds,
  auto_assign_tables, allow_online_waitlist, cancellation_window_hours,
  brand_json, contact_phone, contact_email, address_text
) VALUES (
  ${q(LOCATION_ID)}, ${q(ORG_ID)}, ${q(TIMEZONE)}, ${q("the-test-kitchen")}, 15,
  90, 30, 1, 8,
  ${q(
    "For parties of more than 8 please call us — we'll look after you properly."
  )}, 60, 90, 600,
  1, 1, 24,
  ${q(JSON.stringify({ accent: "#FF6B6B", displayName: VENUE_NAME }))},
  ${q("0161 000 0000")}, ${q("bookings@thetestkitchen.example")},
  ${q("14 Example Street, Manchester M1 1AA")}
);`
);

for (const room of ROOMS) {
  statements.push(
    `INSERT OR REPLACE INTO rooms (
  id, organization_id, location_id, name, accent_color, online_bookable,
  canvas_width, canvas_height, sort_order, is_active
) VALUES (
  ${q(room.id)}, ${q(ORG_ID)}, ${q(LOCATION_ID)}, ${q(room.name)},
  ${q(room.accent)}, ${q(room.online)}, ${room.w}, ${room.h}, ${room.sort}, 1
);`
  );
}

for (const [
  label,
  roomId,
  seatsMin,
  seatsMax,
  shape,
  x,
  y,
  w,
  h,
  rotation,
  priority,
] of TABLES) {
  statements.push(
    `INSERT OR REPLACE INTO dining_tables (
  id, organization_id, location_id, room_id, label, seats_min, seats_max, shape,
  pos_x, pos_y, width, height, rotation, online_bookable, assign_priority,
  is_active, notes
) VALUES (
  ${q(`tbl-${label}`)}, ${q(ORG_ID)}, ${q(LOCATION_ID)}, ${q(roomId)}, ${q(
      label
    )}, ${seatsMin}, ${seatsMax}, ${q(shape)},
  ${x}, ${y}, ${w}, ${h}, ${rotation}, 1, ${priority}, 1, NULL
);`
  );
}

for (const combo of COMBINATIONS) {
  statements.push(
    `INSERT OR REPLACE INTO table_combinations (
  id, organization_id, location_id, label, seats_min, seats_max,
  assign_priority, online_bookable, is_active
) VALUES (
  ${q(combo.id)}, ${q(ORG_ID)}, ${q(LOCATION_ID)}, ${q(combo.label)},
  ${combo.min}, ${combo.max}, ${combo.priority}, 1, 1
);`
  );
  combo.members.forEach((tableId, index) => {
    statements.push(
      `INSERT OR REPLACE INTO table_combination_members (combination_id, table_id, sort_order)
VALUES (${q(combo.id)}, ${q(tableId)}, ${index});`
    );
  });
}

for (const period of PERIODS) {
  statements.push(
    `INSERT OR REPLACE INTO service_periods (
  id, organization_id, location_id, name, day_of_week, start_time, end_time,
  last_seating_time, slot_interval_min, online_bookable, sort_order, is_active
) VALUES (
  ${q(period.id)}, ${q(ORG_ID)}, ${q(LOCATION_ID)}, ${q(period.name)}, ${q(
      period.day
    )}, ${q(period.start)}, ${q(period.end)},
  ${q(period.lastSeating)}, ${period.interval}, 1, ${period.sort}, 1
);`
  );
  for (const roomId of period.rooms) {
    statements.push(
      `INSERT OR REPLACE INTO service_period_rooms (service_period_id, room_id)
VALUES (${q(period.id)}, ${q(roomId)});`
    );
  }
}

// Venue-scoped turn rules (service_period_id NULL) apply wherever a
// period-scoped rule does not.
for (const [partyMin, partyMax, minutes] of TURN_RULES) {
  statements.push(
    `INSERT OR REPLACE INTO turn_time_rules (
  id, organization_id, location_id, service_period_id, party_min, party_max, turn_minutes
) VALUES (
  ${q(`turn-venue-${partyMin}-${partyMax}`)}, ${q(ORG_ID)}, ${q(
      LOCATION_ID
    )}, NULL, ${partyMin}, ${partyMax}, ${minutes}
);`
  );
}

for (const rule of PACING_RULES) {
  statements.push(
    `INSERT OR REPLACE INTO pacing_rules (
  id, organization_id, location_id, service_period_id, interval_min,
  max_covers, max_bookings, applies_from, applies_to, is_active
) VALUES (
  ${q(`pace-${rule.period}`)}, ${q(ORG_ID)}, ${q(LOCATION_ID)}, ${q(
      rule.period
    )}, ${rule.interval},
  ${rule.covers}, NULL, ${q(rule.from)}, ${q(rule.to)}, 1
);`
  );
}

// ── Reservations ─────────────────────────────────────────────────────────────
/**
 * A believable Friday dinner service so Phase 4 has something to render:
 * a full spread of statuses, allergy and occasion tags, one large party on a
 * combination, and two unassigned bookings for the console's unassigned filter.
 *
 * Dated relative to today so the demo is always "tonight" — the service date
 * is the next Friday, computed in the calendar domain rather than from a UTC
 * timestamp, per the venue-local time rule.
 */
function nextFriday() {
  const now = new Date();
  const utcMidnight = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate()
  );
  // 5 = Friday in getUTCDay()'s Sunday-based numbering.
  const daysAhead = (5 - new Date(utcMidnight).getUTCDay() + 7) % 7 || 7;
  const target = new Date(utcMidnight + daysAhead * 86_400_000);
  return target.toISOString().slice(0, 10);
}

const SERVICE_DATE = nextFriday();
const DINNER_PERIOD = "period-dinner-fri";

/** Crockford base-32, no I/L/O/U — matches reference.ts. */
function reference(seed) {
  const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  let out = "";
  let n = seed * 2654435761;
  for (let i = 0; i < 6; i++) {
    out += alphabet[Math.abs(n >> (i * 5)) % alphabet.length];
  }
  return out;
}

function addMinutes(hhmm, minutes) {
  const [h, m] = hhmm.split(":").map(Number);
  const total = h * 60 + m + minutes;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(
    total % 60
  ).padStart(2, "0")}`;
}

// [name, party, start, turn, tables, status, source, tags, allergies, occasion]
const RESERVATIONS = [
  ["Sarah Jones", 2, "18:00", 90, ["tbl-1"], "finished", "online", [], null, null],
  ["Tom Whitfield", 4, "18:15", 105, ["tbl-5"], "finished", "phone", [], null, null],
  ["Priya Raman", 2, "18:30", 90, ["tbl-2"], "seated", "online", ["vip"], "Coeliac", null],
  ["Daniel Okafor", 4, "19:00", 105, ["tbl-6"], "seated", "online", [], null, "Birthday"],
  ["Ellie Marsh", 6, "19:00", 120, ["tbl-10"], "seated", "phone", [], "Nut allergy", null],
  ["James Bell", 2, "19:15", 90, ["tbl-8"], "confirmed", "online", [], null, null],
  ["Aisha Khan", 4, "19:30", 105, ["tbl-7"], "confirmed", "online", ["first_visit"], null, null],
  ["Marcus Ford", 12, "19:30", 180, ["tbl-14", "tbl-15"], "confirmed", "phone", ["vip"], null, "Anniversary"],
  ["Nina Kowalski", 2, "19:45", 90, ["tbl-9"], "confirmed", "online", [], "Dairy free", null],
  ["Robert Chen", 4, "20:00", 105, ["tbl-11"], "confirmed", "online", [], null, null],
  ["Hannah Lowe", 2, "20:15", 90, ["tbl-3"], "confirmed", "walk_in", [], null, null],
  ["Owen Pritchard", 8, "20:15", 150, ["tbl-12"], "confirmed", "phone", [], null, null],
  ["Grace Adeyemi", 2, "20:30", 90, ["tbl-4"], "confirmed", "online", [], null, null],
  ["Luis Fernandez", 4, "20:30", 105, [], "confirmed", "phone", [], null, null],
  ["Clara Bennett", 2, "20:45", 90, [], "confirmed", "online", [], null, null],
  ["Peter Nowak", 2, "18:45", 90, ["tbl-B5"], "no_show", "online", [], null, null],
  ["Yasmin Haddad", 4, "19:15", 105, ["tbl-T1"], "cancelled", "online", [], null, null],
];

statements.push(
  `-- Reservations for ${SERVICE_DATE}, re-runnable via deterministic ids.
DELETE FROM reservation_tables WHERE reservation_id IN (
  SELECT id FROM reservations WHERE location_id = ${q(
    LOCATION_ID
  )} AND service_date = ${q(SERVICE_DATE)}
);
DELETE FROM reservation_events WHERE reservation_id IN (
  SELECT id FROM reservations WHERE location_id = ${q(
    LOCATION_ID
  )} AND service_date = ${q(SERVICE_DATE)}
);
DELETE FROM reservations WHERE location_id = ${q(
    LOCATION_ID
  )} AND service_date = ${q(SERVICE_DATE)};`
);

RESERVATIONS.forEach((row, index) => {
  const [name, party, start, turn, tables, status, source, tags, allergies, occasion] = row;
  const id = `res-demo-${index + 1}`;
  const end = addMinutes(start, turn);
  const roomId = tables.length
    ? (TABLES.find((t) => `tbl-${t[0]}` === tables[0])?.[1] ?? null)
    : null;

  const seatedAt = ["seated", "finished"].includes(status)
    ? `datetime('now')`
    : "NULL";
  const finishedAt = status === "finished" ? `datetime('now')` : "NULL";
  const cancelledAt = status === "cancelled" ? `datetime('now')` : "NULL";
  const noShowAt = status === "no_show" ? `datetime('now')` : "NULL";

  statements.push(
    `INSERT OR REPLACE INTO reservations (
  id, organization_id, location_id, reference, contact_id, guest_name, guest_phone,
  guest_email, party_size, service_date, start_time, end_time, starts_at_utc,
  service_period_id, room_id, status, source, assignment_locked, occasion,
  allergies, guest_notes, staff_notes, tags_json, deposit_required_pence,
  seated_at, finished_at, cancelled_at, no_show_marked_at, marketing_opt_in
) VALUES (
  ${q(id)}, ${q(ORG_ID)}, ${q(LOCATION_ID)}, ${q(reference(index + 1))}, NULL,
  ${q(name)}, ${q(`+44770090${String(1000 + index).slice(-4)}`)}, NULL,
  ${party}, ${q(SERVICE_DATE)}, ${q(start)}, ${q(end)},
  ${q(`${SERVICE_DATE}T${start}:00.000Z`)},
  ${q(DINNER_PERIOD)}, ${roomId ? q(roomId) : "NULL"}, ${q(status)}, ${q(source)},
  0, ${occasion ? q(occasion) : "NULL"}, ${allergies ? q(allergies) : "NULL"},
  NULL, NULL, ${q(JSON.stringify(tags))}, 0,
  ${seatedAt}, ${finishedAt}, ${cancelledAt}, ${noShowAt}, 0
);`
  );

  for (const tableId of tables) {
    statements.push(
      `INSERT OR IGNORE INTO reservation_tables (reservation_id, table_id)
VALUES (${q(id)}, ${q(tableId)});`
    );
  }

  statements.push(
    `INSERT OR REPLACE INTO reservation_events (id, organization_id, reservation_id, type, actor, data_json)
VALUES (${q(`revt-demo-${index + 1}`)}, ${q(ORG_ID)}, ${q(id)}, 'created', 'seed', NULL);`
  );
});

const sql = statements.join("\n\n");

if (printOnly) {
  console.log(sql);
  process.exit(0);
}

const tmpDir = mkdtempSync(join(tmpdir(), "seed-venue-"));
const sqlFile = join(tmpDir, "seed-venue-demo.sql");
writeFileSync(sqlFile, sql, "utf8");

const target = local ? "--local" : "--remote";
console.log(
  `Seeding ${VENUE_NAME} into ${DB_NAME} ${target} (org ${ORG_ID})\n` +
    `  ${ROOMS.length} rooms, ${TABLES.length} tables, ${COMBINATIONS.length} combinations,\n` +
    `  ${PERIODS.length} service periods, ${TURN_RULES.length} turn rules, ${PACING_RULES.length} pacing rules,\n` +
    `  ${RESERVATIONS.length} reservations for ${SERVICE_DATE}`
);

try {
  execSync(
    `npx wrangler d1 execute ${DB_NAME} ${target} --file="${sqlFile}" --config="${WRANGLER_TOML}"`,
    { cwd: WRANGLER_DIR, stdio: "inherit" }
  );
  console.log("\nSeeded. Re-running this script is safe — ids are deterministic.");
} catch (error) {
  console.error("\nSeed failed. Are migrations 0034 and 0035 applied?");
  process.exitCode = 1;
} finally {
  unlinkSync(sqlFile);
}
