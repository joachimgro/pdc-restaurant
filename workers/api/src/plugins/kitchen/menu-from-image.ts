import { aiEnabled, extractModelText } from "../../ai/workers-ai";
import type { Env } from "../../env";
import {
  parseMenuImport,
  type ParsedMenuCategory,
} from "./menu-import";

const VISION_MODEL = "@cf/llava-hf/llava-1.5-7b-hf";

const MENU_VISION_PROMPT = `This image is a restaurant menu. Extract every section/category and dish.
Reply with ONLY valid JSON (no markdown fences, no commentary):
{"categories":[{"name":"Starters","station":"restaurant","items":[{"name":"Soup","pricePence":650}]}]}
Rules:
- pricePence is integer UK pence (£6.50 → 650). Use 0 if price missing or unclear.
- station MUST be one of: "restaurant" (hot food / dining), "cafe" (coffee, tea, soft drinks, pastries), "bar" (alcohol, cocktails, beer, wine).
- Keep dish names short and clean. Skip allergen boilerplate, addresses, and marketing blurbs.
- If the menu has multiple columns/pages visible, include everything readable.`;

/** Serialize parsed categories into the same markdown our text importer accepts. */
export function categoriesToMenuText(categories: ParsedMenuCategory[]): string {
  return categories
    .map((cat) => {
      const station = normalizeImportStation(cat.station);
      const header =
        station !== "restaurant"
          ? `## ${cat.name} | station=${station}`
          : `## ${cat.name}`;
      const lines = cat.items.map((item) => {
        if (item.pricePence > 0) {
          const pounds = (item.pricePence / 100).toFixed(2);
          const tidy = pounds.replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
          return `${item.name} - £${tidy}`;
        }
        return item.name;
      });
      return `${header}\n${lines.join("\n")}`;
    })
    .join("\n\n");
}

function normalizeImportStation(raw: string | null | undefined): string {
  const s = (raw ?? "").trim().toLowerCase();
  if (["bar", "drinks", "cocktail"].includes(s)) return "bar";
  if (["cafe", "coffee", "café"].includes(s)) return "cafe";
  if (["kitchen", "restaurant", "food", "dining"].includes(s) || !s) {
    return "restaurant";
  }
  return s;
}

function extractJsonObject(raw: string): unknown | null {
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

export type MenuImageParseResult = {
  text: string;
  categories: ParsedMenuCategory[];
  rawModelText: string;
};

export async function parseMenuFromImage(
  env: Env,
  imageBytes: Uint8Array
): Promise<MenuImageParseResult> {
  if (!aiEnabled(env) || !env.AI) {
    throw new Error("AI is not enabled for this venue");
  }
  if (imageBytes.byteLength === 0) {
    throw new Error("Empty image");
  }
  if (imageBytes.byteLength > 4_500_000) {
    throw new Error("Image is too large (max ~4MB)");
  }

  const result = await env.AI.run(VISION_MODEL, {
    prompt: MENU_VISION_PROMPT,
    image: Array.from(imageBytes),
    max_tokens: 2048,
  });

  const rawModelText = extractModelText(result).trim();
  if (!rawModelText) {
    throw new Error("Vision model returned no text");
  }

  let categories: ParsedMenuCategory[] = [];
  const json = extractJsonObject(rawModelText);
  if (json) {
    try {
      categories = parseMenuImport(JSON.stringify(json));
    } catch {
      categories = [];
    }
  }
  if (categories.length === 0) {
    try {
      categories = parseMenuImport(rawModelText);
    } catch {
      categories = [];
    }
  }

  if (categories.length === 0) {
    throw new Error(
      "Could not read a menu from that photo. Try a clearer shot, or paste the menu as text."
    );
  }

  return {
    text: categoriesToMenuText(categories),
    categories,
    rawModelText,
  };
}
