/**
 * Parse a pasted menu into categories + items.
 *
 * Supports:
 * 1) JSON: { "categories": [{ "name", "station?", "items": [{ "name", "pricePence?" }] }] }
 * 2) Plain text:
 *      ## Mains
 *      House Burger - £16.50
 *      Salmon
 *
 *      Desserts
 *      Brownie £7
 *      - Affogato
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

function parsePriceTail(line: string): { name: string; pricePence: number } {
  const trimmed = line.replace(/^[-•*]\s*/, "").trim();
  const match = trimmed.match(PRICE_RE);
  if (!match || match.index === undefined || match.index < 2) {
    return { name: trimmed, pricePence: 0 };
  }
  const raw = match[1];
  const name = trimmed.slice(0, match.index).replace(/[-–—|]\s*$/, "").trim();
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

export function parseMenuImport(raw: string): ParsedMenuCategory[] {
  const text = raw.trim();
  if (!text) return [];

  if (text.startsWith("{") || text.startsWith("[")) {
    return parseJsonMenu(text);
  }
  return parseTextMenu(text);
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
      items.push({
        name: itemName,
        description:
          i.description === null || i.description === undefined
            ? null
            : String(i.description),
        pricePence: Math.max(0, Math.round(Number(i.pricePence ?? 0) || 0)),
        station:
          i.station === null || i.station === undefined
            ? station
            : normalizeStationId(String(i.station)),
      });
    }
    out.push({ name, station, items });
  }
  return out;
}

function parseTextMenu(text: string): ParsedMenuCategory[] {
  const lines = text.split(/\r?\n/);
  const categories: ParsedMenuCategory[] = [];
  let current: ParsedMenuCategory | null = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    // Headings: markdown ##, trailing colon, ALL CAPS, or "| station="
    const isMarkdown = /^#{1,3}\s+\S/.test(line);
    const isColonHeader =
      /^[A-Za-z][\w &/'-]{0,48}:\s*$/.test(line) && !PRICE_RE.test(line);
    const isAllCaps =
      /^[A-Z0-9][A-Z0-9 &/'-]{1,48}$/.test(line) &&
      /[A-Z]/.test(line) &&
      line === line.toUpperCase() &&
      !PRICE_RE.test(line);
    const isStationHint = /\|\s*station\s*=/i.test(line) && !/^\s*[-•*]/.test(line);

    if (isMarkdown || isColonHeader || isAllCaps || isStationHint) {
      const { name, station } = parseStationHint(line.replace(/:\s*$/, ""));
      if (!name) continue;
      current = { name, station, items: [] };
      categories.push(current);
      continue;
    }

    if (!current) {
      current = { name: "Menu", station: "restaurant", items: [] };
      categories.push(current);
    }

    const { name, pricePence } = parsePriceTail(line);
    if (!name) continue;
    current.items.push({
      name,
      description: null,
      pricePence,
      station: null,
    });
  }

  return categories.filter((c) => c.items.length > 0);
}
