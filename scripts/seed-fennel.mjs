#!/usr/bin/env node
/**
 * Fennel trial seed: upsert org/venue/floor from docs/trial/fennel-floor.json
 * and menu from docs/trial/fennel-menu.json.
 *
 * Never deletes menu items. Upserts by category name + item name. Sets available=1.
 *
 * Usage (from repo root):
 *   node scripts/seed-fennel.mjs --local
 *   node scripts/seed-fennel.mjs --local --config=workers/api/wrangler.dev.toml
 *   node scripts/seed-fennel.mjs --print
 */
import {
  readFileSync,
  writeFileSync,
  unlinkSync,
  mkdtempSync,
  existsSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const WRANGLER_DIR = join(ROOT, "workers", "api");

const local = process.argv.includes("--local");
const printOnly = process.argv.includes("--print");
const configArg = process.argv.find((a) => a.startsWith("--config="));
const WRANGLER_TOML = configArg
  ? join(ROOT, configArg.slice("--config=".length))
  : join(WRANGLER_DIR, local ? "wrangler.dev.toml" : "wrangler.toml");

function readToml(key) {
  const source = readFileSync(WRANGLER_TOML, "utf8");
  const match = source.match(new RegExp(`^\\s*${key}\\s*=\\s*"([^"]+)"`, "m"));
  return match ? match[1] : null;
}

const ORG_ID = readToml("ORGANIZATION_ID");
const DB_NAME = readToml("database_name");
if (!ORG_ID || ORG_ID === "CHANGE_ME") {
  console.error(`ORGANIZATION_ID missing/CHANGE_ME in ${WRANGLER_TOML}`);
  process.exit(1);
}
if (!DB_NAME || DB_NAME === "pdc-CHANGE_ME-db") {
  console.error(`database_name missing in ${WRANGLER_TOML}`);
  process.exit(1);
}

const FLOOR_PATH = join(ROOT, "docs", "trial", "fennel-floor.json");
const MENU_PATH = join(ROOT, "docs", "trial", "fennel-menu.json");
if (!existsSync(FLOOR_PATH) || !existsSync(MENU_PATH)) {
  console.error("Missing docs/trial/fennel-floor.json or fennel-menu.json");
  process.exit(1);
}

const floor = JSON.parse(readFileSync(FLOOR_PATH, "utf8"));
const menu = JSON.parse(readFileSync(MENU_PATH, "utf8"));
const nowIso = new Date().toISOString();

function q(value) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "1" : "0";
  return `'${String(value).replace(/'/g, "''")}'`;
}

function stableId(prefix, ...parts) {
  const h = createHash("sha1")
    .update(parts.map((p) => String(p).trim().toLowerCase()).join("|"))
    .digest("hex")
    .slice(0, 12);
  return `${prefix}-${h}`;
}

const orgName = floor.organization?.name ?? "Fennel";
const loc = floor.location ?? {};
const LOCATION_ID = loc.id || "venue-main";
const venueName = loc.name || "Fennel";
const timezone = loc.timezone || "Europe/London";
const abbrev = loc.abbrev || "FNL";
const bookingSlug = loc.bookingSlug || "fennel";
const quickNotes = Array.isArray(menu.quick_notes) ? menu.quick_notes : [];
const brandPatch = {
  accent: "#2F6F4E",
  displayName: venueName,
  quickNotes,
};
const brandJson = JSON.stringify(brandPatch);

// Keep the order UI constant in sync with menu JSON (brand is source of truth at runtime).
const notesForConst = quickNotes.includes("Custom")
  ? quickNotes
  : [...quickNotes, "Custom"];
const quickNotesTs = `export const QUICK_NOTES = ${JSON.stringify(
  notesForConst,
  null,
  2
)} as const;\n`;
writeFileSync(
  join(ROOT, "apps", "web", "src", "plugins", "order", "quickNotes.ts"),
  quickNotesTs,
  "utf8"
);

const statements = [];

statements.push(
  `INSERT INTO organizations (id, name) VALUES (${q(ORG_ID)}, ${q(orgName)})
ON CONFLICT(id) DO UPDATE SET name = excluded.name;`
);

statements.push(
  `INSERT INTO locations (id, organization_id, name, abbrev)
VALUES (${q(LOCATION_ID)}, ${q(ORG_ID)}, ${q(venueName)}, ${q(abbrev)})
ON CONFLICT(id) DO UPDATE SET name = excluded.name, abbrev = excluded.abbrev;`
);

statements.push(
  `INSERT INTO venue_settings (
  location_id, organization_id, timezone, booking_slug, slot_interval_min,
  default_turn_minutes, grace_after_close_min, min_party_online, max_party_online,
  large_party_message, min_lead_minutes, max_advance_days, hold_ttl_seconds,
  auto_assign_tables, allow_online_waitlist, cancellation_window_hours,
  brand_json, contact_phone, contact_email, address_text
) VALUES (
  ${q(LOCATION_ID)}, ${q(ORG_ID)}, ${q(timezone)}, ${q(bookingSlug)}, 15,
  90, 30, 1, 8,
  ${q("For parties of more than 8 please call us.")}, 60, 90, 600,
  1, 0, 24,
  ${q(brandJson)},
  ${q(loc.phone ?? null)}, ${q(loc.email ?? null)}, ${q(loc.address ?? null)}
)
ON CONFLICT(location_id) DO UPDATE SET
  timezone = excluded.timezone,
  booking_slug = excluded.booking_slug,
  brand_json = json_patch(COALESCE(venue_settings.brand_json, '{}'), excluded.brand_json),
  contact_phone = excluded.contact_phone,
  contact_email = excluded.contact_email,
  address_text = excluded.address_text;`
);

for (const room of floor.rooms ?? []) {
  statements.push(
    `INSERT INTO rooms (
  id, organization_id, location_id, name, accent_color, online_bookable,
  canvas_width, canvas_height, sort_order, is_active, created_at, updated_at
) VALUES (
  ${q(room.id)}, ${q(ORG_ID)}, ${q(LOCATION_ID)}, ${q(room.name)},
  ${q(room.accent ?? null)}, ${room.online === false ? 0 : 1},
  ${room.w ?? 1200}, ${room.h ?? 800}, ${room.sort ?? 0}, 1,
  ${q(nowIso)}, ${q(nowIso)}
)
ON CONFLICT(id) DO UPDATE SET
  name = excluded.name,
  accent_color = excluded.accent_color,
  online_bookable = excluded.online_bookable,
  canvas_width = excluded.canvas_width,
  canvas_height = excluded.canvas_height,
  sort_order = excluded.sort_order,
  is_active = 1,
  updated_at = excluded.updated_at;`
  );
}

for (const row of floor.tables ?? []) {
  const [
    label,
    roomId,
    seatsMin,
    seatsMax,
    shape,
    posX,
    posY,
    width,
    height,
    rotation,
    priority,
  ] = row;
  const id = stableId("fnl-tbl", LOCATION_ID, label);
  statements.push(
    `INSERT INTO dining_tables (
  id, organization_id, location_id, room_id, label, seats_min, seats_max, shape,
  pos_x, pos_y, width, height, rotation, online_bookable, assign_priority,
  is_active, created_at, updated_at
) VALUES (
  ${q(id)}, ${q(ORG_ID)}, ${q(LOCATION_ID)}, ${q(roomId)}, ${q(label)},
  ${seatsMin}, ${seatsMax}, ${q(shape)},
  ${posX}, ${posY}, ${width}, ${height}, ${rotation ?? 0}, 1, ${priority ?? 100},
  1, ${q(nowIso)}, ${q(nowIso)}
)
ON CONFLICT(location_id, label) DO UPDATE SET
  room_id = excluded.room_id,
  seats_min = excluded.seats_min,
  seats_max = excluded.seats_max,
  shape = excluded.shape,
  pos_x = excluded.pos_x,
  pos_y = excluded.pos_y,
  width = excluded.width,
  height = excluded.height,
  rotation = excluded.rotation,
  assign_priority = excluded.assign_priority,
  is_active = 1,
  updated_at = excluded.updated_at;`
  );
}

let catSort = 10;
for (const cat of menu.categories ?? []) {
  const catId = stableId("fnl-cat", LOCATION_ID, cat.name);
  const station = cat.station || "kitchen";
  const defaultCourse =
    cat.default_course === undefined ? null : cat.default_course;
  statements.push(
    `INSERT INTO menu_categories (
  id, organization_id, location_id, name, station, default_course,
  sort_order, is_active, created_at, updated_at
) VALUES (
  ${q(catId)}, ${q(ORG_ID)}, ${q(LOCATION_ID)}, ${q(cat.name)}, ${q(station)},
  ${q(defaultCourse)}, ${catSort}, 1, ${q(nowIso)}, ${q(nowIso)}
)
ON CONFLICT(id) DO UPDATE SET
  name = excluded.name,
  station = excluded.station,
  default_course = excluded.default_course,
  sort_order = excluded.sort_order,
  is_active = 1,
  updated_at = excluded.updated_at;`
  );

  // Also upsert by name if an older id exists for the same category name.
  statements.push(
    `UPDATE menu_categories
SET station = ${q(station)},
    default_course = ${q(defaultCourse)},
    sort_order = ${catSort},
    is_active = 1,
    updated_at = ${q(nowIso)}
WHERE organization_id = ${q(ORG_ID)}
  AND location_id = ${q(LOCATION_ID)}
  AND lower(name) = lower(${q(cat.name)})
  AND id != ${q(catId)};`
  );

  let itemSort = 10;
  for (const item of cat.items ?? []) {
    const itemId = stableId("fnl-item", LOCATION_ID, cat.name, item.name);
    const price = Math.max(0, Math.round(item.price_pence ?? 0));
    const description =
      typeof item.description === "string" && item.description.trim()
        ? item.description.trim()
        : null;
    const choices =
      item.choices == null ? null : JSON.stringify(item.choices);
    const itemStation = item.station || station;
    statements.push(
      `INSERT INTO menu_items (
  id, organization_id, location_id, category_id, name, description,
  price_pence, station, sort_order, is_active, available, choices,
  unavailable_at, created_at, updated_at
) VALUES (
  ${q(itemId)}, ${q(ORG_ID)}, ${q(LOCATION_ID)}, ${q(catId)}, ${q(item.name)},
  ${q(description)}, ${price}, ${q(itemStation)}, ${itemSort}, 1, 1, ${q(choices)},
  NULL, ${q(nowIso)}, ${q(nowIso)}
)
ON CONFLICT(id) DO UPDATE SET
  category_id = excluded.category_id,
  name = excluded.name,
  description = excluded.description,
  price_pence = excluded.price_pence,
  station = excluded.station,
  sort_order = excluded.sort_order,
  is_active = 1,
  available = 1,
  unavailable_at = NULL,
  choices = excluded.choices,
  updated_at = excluded.updated_at;`
    );

    // Name-keyed upsert for items that already exist under another id.
    statements.push(
      `UPDATE menu_items
SET category_id = ${q(catId)},
    description = ${q(description)},
    price_pence = ${price},
    station = ${q(itemStation)},
    sort_order = ${itemSort},
    is_active = 1,
    available = 1,
    unavailable_at = NULL,
    choices = ${q(choices)},
    updated_at = ${q(nowIso)}
WHERE organization_id = ${q(ORG_ID)}
  AND location_id = ${q(LOCATION_ID)}
  AND category_id IN (
    SELECT id FROM menu_categories
    WHERE organization_id = ${q(ORG_ID)}
      AND location_id = ${q(LOCATION_ID)}
      AND lower(name) = lower(${q(cat.name)})
  )
  AND lower(name) = lower(${q(item.name)})
  AND id != ${q(itemId)};`
    );
    itemSort += 10;
  }
  catSort += 10;
}

const sql = statements.join("\n\n");
if (printOnly) {
  console.log(sql);
  process.exit(0);
}

const tmpDir = mkdtempSync(join(tmpdir(), "seed-fennel-"));
const sqlFile = join(tmpDir, "seed-fennel.sql");
writeFileSync(sqlFile, sql, "utf8");
const target = local ? "--local" : "--remote";

try {
  execSync(
    `npx wrangler d1 execute ${DB_NAME} ${target} --file="${sqlFile}" --config="${WRANGLER_TOML}"`,
    { cwd: WRANGLER_DIR, stdio: "inherit" }
  );
  const itemCount = (menu.categories ?? []).reduce(
    (n, c) => n + (c.items?.length ?? 0),
    0
  );
  console.log(
    `\nFennel seeded: org “${orgName}”, ${(floor.rooms ?? []).length} rooms, ${(floor.tables ?? []).length} tables, ${(menu.categories ?? []).length} categories / ${itemCount} items (available=1).`
  );
  console.log(
    "quick_notes merged into venue_settings.brand_json.quickNotes (json_patch; preserves other brand keys). Also synced apps/web/src/plugins/order/quickNotes.ts."
  );
} catch {
  console.error("\nFennel seed failed. Apply migrations first.");
  process.exitCode = 1;
} finally {
  unlinkSync(sqlFile);
}
