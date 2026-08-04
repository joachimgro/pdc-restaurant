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
    `  ${PERIODS.length} service periods, ${TURN_RULES.length} turn rules, ${PACING_RULES.length} pacing rules`
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
