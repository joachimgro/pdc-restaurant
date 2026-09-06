/**
 * Parse a pasted menu into categories + items.
 *
 * Supports:
 * 1) JSON: { "categories": [{ "name", "station?", "items": [{ "name", "pricePence?" }] }] }
 *    (JSON may be wrapped in prose or markdown fences.)
 * 2) Plain text:
 *      ## Mains
 *      House Burger - £16.50
 *      Salmon
 *
 *      Desserts
 *      Brownie £7
 *      - Affogato
 *
 * Printed-menu quirks: dotted price leaders, wrapped ingredient lines, ALL CAPS
 * section headers, allergy/service-charge footers, restaurant-name watermarks.
 */

export type ParsedMenuItem = {
  name: string;
  description: string | null;
  pricePence: number;
  station: string | null;
};

export type ParsedMenuCategory = {
  name: string;
  station: string;
  items: ParsedMenuItem[];
};

const PRICE_RE =
  /(?:[-–—|]\s*)?(?:£\s*)?(\d+(?:\.\d{1,2})?)\s*(?:p)?\s*$/i;

const SKIP_LINE_RE =
  /^(please inform|a discretionary|allerg|dietary requirement|service charge|neighbourhood restaurant|vat\b|all prices)/i;

const SKIP_SECTION_RE =
  /^(fennel|neighbourhood restaurant|menu|our menu|today'?s menu)$/i;

function stripPriceLeaders(value: string): string {
  return value
    .replace(/[\s.·•…⋅﹒]{2,}$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function parsePriceTail(line: string): { name: string; pricePence: number } {
  const trimmed = stripPriceLeaders(line.replace(/^[-•*]\s*/, "").trim());
  const match = trimmed.match(PRICE_RE);
  if (!match || match.index === undefined || match.index < 2) {
    return { name: trimmed.replace(/[,;:]\s*$/, ""), pricePence: 0 };
  }
  const raw = match[1];
  const name = stripPriceLeaders(
    trimmed.slice(0, match.index).replace(/[-–—|]\s*$/, "").trim()
  ).replace(/[,;:]\s*$/, "");
  if (!name) return { name: trimmed, pricePence: 0 };
  const n = Number(raw);
  if (Number.isNaN(n)) return { name: trimmed, pricePence: 0 };
  // Values like 16.50 → pounds; bare integers ≥ 100 likely already pence
  const pricePence =
    raw.includes(".") || n < 100 ? Math.round(n * 100) : Math.round(n);
  return { name, pricePence };
}

function normalizeStationId(raw: string | null | undefined): string {
  const s = (raw ?? "").trim().toLowerCase();
  if (["bar", "drinks", "cocktail"].includes(s)) return "bar";
  if (["cafe", "coffee", "café"].includes(s)) return "cafe";
  if (["kitchen", "restaurant", "food", "dining", ""].includes(s)) {
    return "restaurant";
  }
  return s;
}

function parseStationHint(header: string): { name: string; station: string } {
  const stationMatch = header.match(/\|\s*station\s*=\s*([a-z0-9_-]+)/i);
  const station = normalizeStationId(stationMatch?.[1] ?? "restaurant");
  const name = header
    .replace(/\|\s*station\s*=\s*[a-z0-9_-]+/i, "")
    .replace(/^#+\s*/, "")
    .trim();
  return { name, station };
}

export function extractJsonObject(raw: string): unknown | null {
  const trimmed = raw.trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fence ? fence[1].trim() : trimmed;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
}

export function parseMenuImport(raw: string): ParsedMenuCategory[] {
  const text = raw.trim();
  if (!text) return [];

  const json = extractJsonObject(text);
  if (json) {
    try {
      const fromJson = parseJsonMenu(JSON.stringify(json));
      if (fromJson.length > 0) return fromJson;
    } catch {
      // Fall through to text — vision models often wrap JSON in chatter.
    }
  }

  if (text.startsWith("{") || text.startsWith("[")) {
    return parseJsonMenu(text);
  }
  return parseTextMenu(text);
}

function itemPricePence(item: Record<string, unknown>): number {
  const raw = item.pricePence ?? item.price_pence ?? 0;
  return Math.max(0, Math.round(Number(raw) || 0));
}

function parseJsonMenu(text: string): ParsedMenuCategory[] {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("Menu JSON is invalid");
  }

  const root = Array.isArray(data)
    ? { categories: data }
    : (data as { categories?: unknown });

  if (!root || !Array.isArray(root.categories)) {
    throw new Error('JSON must include a "categories" array');
  }

  const out: ParsedMenuCategory[] = [];
  for (const cat of root.categories) {
    if (!cat || typeof cat !== "object") continue;
    const c = cat as Record<string, unknown>;
    const name = String(c.name ?? "").trim();
    if (!name) continue;
    const station = normalizeStationId(String(c.station ?? "restaurant"));
    const itemsRaw = Array.isArray(c.items) ? c.items : [];
    const items: ParsedMenuItem[] = [];
    for (const item of itemsRaw) {
      if (!item || typeof item !== "object") continue;
      const i = item as Record<string, unknown>;
      const itemName = String(i.name ?? "").trim();
      if (!itemName) continue;
      const descriptionRaw = i.description;
      items.push({
        name: itemName,
        description:
          descriptionRaw === null || descriptionRaw === undefined
            ? null
            : String(descriptionRaw).trim() || null,
        pricePence: itemPricePence(i),
        station:
          i.station === null || i.station === undefined || i.station === ""
            ? null
            : normalizeStationId(String(i.station)),
      });
    }
    out.push({ name, station, items });
  }
  return out;
}

function isSectionHeader(line: string): boolean {
  const isMarkdown = /^#{1,3}\s+\S/.test(line);
  const isColonHeader =
    /^[A-Za-z][\w &/'-]{0,48}:\s*$/.test(line) && !PRICE_RE.test(line);
  const isAllCaps =
    /^[A-Z0-9][A-Z0-9 &/'-]{1,48}$/.test(line) &&
    /[A-Z]/.test(line) &&
    line === line.toUpperCase() &&
    !PRICE_RE.test(line);
  const isStationHint =
    /\|\s*station\s*=/i.test(line) && !/^\s*[-•*]/.test(line);
  return isMarkdown || isColonHeader || isAllCaps || isStationHint;
}

function looksLikeDescription(line: string, prev: ParsedMenuItem | null): boolean {
  if (!prev) return false;
  const { name } = parsePriceTail(line);
  if (!name) return false;
  // Wrapped garnish lines on printed menus are almost always lowercase.
  // Do not treat a new Title-Case dish ("Pangrattato fries, Parmesan…") as
  // a description just because it contains commas.
  return /^[a-z]/.test(name);
}

function appendDescription(item: ParsedMenuItem, extra: string): void {
  const clean = extra.trim();
  if (!clean) return;
  item.description = item.description ? `${item.description}, ${clean}` : clean;
}

function parseTextMenu(text: string): ParsedMenuCategory[] {
  const lines = text.split(/\r?\n/);
  const categories: ParsedMenuCategory[] = [];
  let current: ParsedMenuCategory | null = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (SKIP_LINE_RE.test(line)) continue;

    if (isSectionHeader(line)) {
      const { name, station } = parseStationHint(line.replace(/:\s*$/, ""));
      if (!name || SKIP_SECTION_RE.test(name)) continue;
      current = { name, station, items: [] };
      categories.push(current);
      continue;
    }

    if (!current) {
      current = { name: "Menu", station: "restaurant", items: [] };
      categories.push(current);
    }

    const prev = current.items[current.items.length - 1] ?? null;
    const { name, pricePence } = parsePriceTail(line);
    if (!name) continue;

    if (looksLikeDescription(line, prev) && prev) {
      appendDescription(prev, name);
      if (pricePence > 0 && prev.pricePence === 0) prev.pricePence = pricePence;
      continue;
    }

    current.items.push({
      name,
      description: null,
      pricePence,
      station: null,
    });
  }

  return categories.filter((c) => c.items.length > 0);
}

export function categoriesToImportJson(categories: ParsedMenuCategory[]): string {
  return JSON.stringify(
    {
      categories: categories.map((cat) => ({
        name: cat.name,
        station: cat.station,
        items: cat.items.map((item) => ({
          name: item.name,
          description: item.description,
          pricePence: item.pricePence,
        })),
      })),
    },
    null,
    2
  );
}

/** Serialize parsed categories into markdown the text importer still accepts. */
export function categoriesToMenuText(categories: ParsedMenuCategory[]): string {
  return categories
    .map((cat) => {
      const station = normalizeStationId(cat.station);
      const header =
        station !== "restaurant"
          ? `## ${cat.name} | station=${station}`
          : `## ${cat.name}`;
      const lines = cat.items.flatMap((item) => {
        const nameLine =
          item.pricePence > 0
            ? `${item.name} - £${formatPounds(item.pricePence)}`
            : item.name;
        return item.description ? [nameLine, item.description] : [nameLine];
      });
      return `${header}\n${lines.join("\n")}`;
    })
    .join("\n\n");
}

function formatPounds(pricePence: number): string {
  const pounds = (pricePence / 100).toFixed(2);
  return pounds.replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
}
