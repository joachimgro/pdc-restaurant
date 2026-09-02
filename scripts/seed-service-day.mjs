#!/usr/bin/env node
/**
 * Service-day seed on top of the venue floor plan:
 *   - demo menu (≥5 categories × 6 items, including two steaks)
 *   - one seated reservation for today on a real table
 *   - one in_progress kitchen ticket with 3 items for that table
 *
 * Idempotent (deterministic ids). Safe to re-run.
 *
 * Usage (from repo root):
 *   node scripts/seed-venue-demo.mjs --local --config=workers/api/wrangler.dev.toml
 *   node scripts/seed-service-day.mjs --local --config=workers/api/wrangler.dev.toml
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
  : join(WRANGLER_DIR, "wrangler.dev.toml");

function readToml(key) {
  const source = readFileSync(WRANGLER_TOML, "utf8");
  const match = source.match(new RegExp(`^\\s*${key}\\s*=\\s*"([^"]+)"`, "m"));
  return match ? match[1] : null;
}

const ORG_ID = readToml("ORGANIZATION_ID");
const DB_NAME = readToml("database_name");
if (!ORG_ID || !DB_NAME) {
  console.error("ORGANIZATION_ID / database_name missing in", WRANGLER_TOML);
  process.exit(1);
}

const LOCATION_ID = "venue-main";
const TABLE_ID = "tbl-12";
const TABLE_LABEL = "12";

function q(value) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return String(value);
  return `'${String(value).replace(/'/g, "''")}'`;
}

const today = new Date();
const yyyy = today.getFullYear();
const mm = String(today.getMonth() + 1).padStart(2, "0");
const dd = String(today.getDate()).padStart(2, "0");
const SERVICE_DATE = `${yyyy}-${mm}-${dd}`;
const nowIso = new Date().toISOString();

const CATEGORIES = [
  { id: "sd-cat-starters", name: "Starters", station: "restaurant", sort: 10 },
  { id: "sd-cat-mains", name: "Mains", station: "restaurant", sort: 20 },
  { id: "sd-cat-sides", name: "Sides", station: "restaurant", sort: 30 },
  { id: "sd-cat-desserts", name: "Desserts", station: "restaurant", sort: 40 },
  { id: "sd-cat-drinks", name: "Drinks", station: "bar", sort: 50 },
];

const ITEMS = [
  ["sd-item-soup", "sd-cat-starters", "Soup of the day", "restaurant", 750, 10],
  ["sd-item-pate", "sd-cat-starters", "Chicken liver pâté", "restaurant", 850, 20],
  ["sd-item-prawns", "sd-cat-starters", "Prawn cocktail", "restaurant", 950, 30],
  ["sd-item-calamari", "sd-cat-starters", "Calamari", "restaurant", 900, 40],
  ["sd-item-bruschetta", "sd-cat-starters", "Bruschetta", "restaurant", 700, 50],
  ["sd-item-scallops", "sd-cat-starters", "Scallops", "restaurant", 1200, 60],
  ["sd-item-ribeye", "sd-cat-mains", "Ribeye 10oz", "restaurant", 2850, 10],
  ["sd-item-sirloin", "sd-cat-mains", "Sirloin 8oz", "restaurant", 2450, 20],
  ["sd-item-burger", "sd-cat-mains", "House Burger", "restaurant", 1650, 30],
  ["sd-item-salmon", "sd-cat-mains", "Pan-seared Salmon", "restaurant", 2200, 40],
  ["sd-item-pasta", "sd-cat-mains", "Tagliatelle", "restaurant", 1450, 50],
  ["sd-item-chicken", "sd-cat-mains", "Roast chicken", "restaurant", 1750, 60],
  ["sd-item-fries", "sd-cat-sides", "Fries", "restaurant", 450, 10],
  ["sd-item-salad", "sd-cat-sides", "House salad", "restaurant", 500, 20],
  ["sd-item-mash", "sd-cat-sides", "Mash", "restaurant", 450, 30],
  ["sd-item-greens", "sd-cat-sides", "Seasonal greens", "restaurant", 500, 40],
  ["sd-item-onion", "sd-cat-sides", "Onion rings", "restaurant", 550, 50],
  ["sd-item-bread", "sd-cat-sides", "Sourdough", "restaurant", 350, 60],
  ["sd-item-brownie", "sd-cat-desserts", "Brownie", "restaurant", 750, 10],
  ["sd-item-icecream", "sd-cat-desserts", "Ice cream", "restaurant", 650, 20],
  ["sd-item-cheesecake", "sd-cat-desserts", "Cheesecake", "restaurant", 800, 30],
  ["sd-item-affogato", "sd-cat-desserts", "Affogato", "restaurant", 700, 40],
  ["sd-item-fruit", "sd-cat-desserts", "Fruit plate", "restaurant", 600, 50],
  ["sd-item-cheese", "sd-cat-desserts", "Cheese board", "restaurant", 950, 60],
  ["sd-item-negroni", "sd-cat-drinks", "Negroni", "bar", 950, 10],
  ["sd-item-wine", "sd-cat-drinks", "House red", "bar", 650, 20],
  ["sd-item-beer", "sd-cat-drinks", "Lager pint", "bar", 550, 30],
  ["sd-item-soft", "sd-cat-drinks", "Soft drink", "bar", 300, 40],
  ["sd-item-espresso", "sd-cat-drinks", "Espresso", "bar", 250, 50],
  ["sd-item-water", "sd-cat-drinks", "Still water", "bar", 200, 60],
];

const statements = [];

for (const cat of CATEGORIES) {
  statements.push(
    `INSERT OR REPLACE INTO menu_categories (
  id, organization_id, location_id, name, station, sort_order, is_active, created_at, updated_at
) VALUES (
  ${q(cat.id)}, ${q(ORG_ID)}, ${q(LOCATION_ID)}, ${q(cat.name)}, ${q(cat.station)},
  ${cat.sort}, 1, ${q(nowIso)}, ${q(nowIso)}
);`
  );
}

for (const [id, cat, name, station, price, sort] of ITEMS) {
  statements.push(
    `INSERT OR REPLACE INTO menu_items (
  id, organization_id, location_id, category_id, name, station,
  price_pence, sort_order, is_active, created_at, updated_at
) VALUES (
  ${q(id)}, ${q(ORG_ID)}, ${q(LOCATION_ID)}, ${q(cat)}, ${q(name)}, ${q(station)},
  ${price}, ${sort}, 1, ${q(nowIso)}, ${q(nowIso)}
);`
  );
}

const resId = "sd-res-seated-today";
const ticketId = "sd-ticket-in-progress";
statements.push(
  `INSERT OR REPLACE INTO reservations (
  id, organization_id, location_id, reference, guest_name, guest_phone,
  party_size, service_date, start_time, end_time, starts_at_utc,
  status, source, assignment_locked, seated_at, created_at, updated_at
) VALUES (
  ${q(resId)}, ${q(ORG_ID)}, ${q(LOCATION_ID)}, 'SD-SEATED',
  'Alex Trial', '+447700900001', 4, ${q(SERVICE_DATE)}, '19:00', '21:00',
  ${q(`${SERVICE_DATE}T18:00:00.000Z`)}, 'seated', 'walk_in', 1,
  ${q(nowIso)}, ${q(nowIso)}, ${q(nowIso)}
);`
);
statements.push(
  `INSERT OR IGNORE INTO reservation_tables (reservation_id, table_id)
VALUES (${q(resId)}, ${q(TABLE_ID)});`
);
statements.push(
  `INSERT OR REPLACE INTO kitchen_tickets (
  id, organization_id, location_id, reservation_id, table_label, station,
  status, notes, started_at, created_at, updated_at
) VALUES (
  ${q(ticketId)}, ${q(ORG_ID)}, ${q(LOCATION_ID)}, ${q(resId)}, ${q(TABLE_LABEL)},
  'restaurant', 'in_progress', NULL, ${q(nowIso)}, ${q(nowIso)}, ${q(nowIso)}
);`
);

const ticketItems = [
  ["sd-ti-1", "sd-item-soup", "Soup of the day", 1],
  ["sd-ti-2", "sd-item-ribeye", "Ribeye 10oz", 2],
  ["sd-ti-3", "sd-item-fries", "Fries", 1],
];
for (const [id, menuId, name, qty] of ticketItems) {
  statements.push(
    `INSERT OR REPLACE INTO kitchen_ticket_items (
  id, ticket_id, menu_item_id, name, qty, notes, status, created_at, updated_at
) VALUES (
  ${q(id)}, ${q(ticketId)}, ${q(menuId)}, ${q(name)}, ${qty}, NULL, 'in_progress',
  ${q(nowIso)}, ${q(nowIso)}
);`
  );
}

const sql = statements.join("\n\n");
if (printOnly) {
  console.log(sql);
  process.exit(0);
}

// Ensure venue floor exists first.
execSync(
  `node ${JSON.stringify(join(ROOT, "scripts", "seed-venue-demo.mjs"))} ${local ? "--local" : ""} --config=${WRANGLER_TOML.replace(ROOT + "/", "")}`,
  { cwd: ROOT, stdio: "inherit", shell: true }
);

const tmpDir = mkdtempSync(join(tmpdir(), "seed-service-day-"));
const sqlFile = join(tmpDir, "seed-service-day.sql");
writeFileSync(sqlFile, sql, "utf8");
const target = local ? "--local" : "--remote";

try {
  execSync(
    `npx wrangler d1 execute ${DB_NAME} ${target} --file="${sqlFile}" --config="${WRANGLER_TOML}"`,
    { cwd: WRANGLER_DIR, stdio: "inherit" }
  );
  console.log(
    `\nService day seeded for ${SERVICE_DATE}: menu, seated ${TABLE_LABEL}, in_progress ticket.`
  );
} catch {
  console.error("\nService-day seed failed. Apply migrations and venue seed first.");
  process.exitCode = 1;
} finally {
  unlinkSync(sqlFile);
}
