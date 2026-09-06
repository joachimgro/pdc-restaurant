import { aiEnabled, runChatModel } from "../../ai/workers-ai";
import type { Env } from "../../env";
import { parseMenuImport, type ParsedMenuCategory } from "./menu-import";

export const DEFAULT_MENU_JUDGE_MODEL =
  "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

export const MENU_JUDGE_SYSTEM = `You are a restaurant menu normaliser. You receive a noisy transcription of a printed menu (OCR errors, wrapped lines, watermarks, dotted price leaders). Turn it into clean structured JSON for a POS.

Reply with ONLY valid JSON (no markdown fences, no commentary):
{"categories":[{"name":"Starters","station":"restaurant","items":[{"name":"Boquerones","description":"marinated white anchovies","pricePence":700}]}]}

Rules:
- Include every dish that has a name. Do not invent dishes that are not in the extract.
- pricePence is integer UK pence (£6.50 → 650, £7 → 700, £4.95 → 495). Use 0 if the price is missing.
- station MUST be one of: "restaurant" (hot food / dining), "cafe" (coffee, tea, soft drinks, pastries), "bar" (alcohol, cocktails, beer, wine). Default restaurant.
- name is the dish (short). description is garnishes / secondary ingredients, or null.
- Merge wrapped lines: a lowercase ingredient line belongs to the dish above it. One price per dish.
- Skip allergen boilerplate, service charges, addresses, marketing, page numbers, and giant vertical restaurant-name watermarks (they are not dishes).
- Keep printed section headers as category names (Starters, Sharing Board, Meats, Sides, Vegetarian, Desserts, etc.).
- A boxed sharing board is one category with one item.
- Do not convert prices to another currency.`;

export function buildMenuJudgeUserPrompt(rawExtract: string): string {
  return `Normalise this menu extract:\n\n${rawExtract.slice(0, 12_000)}`;
}

export async function judgeMenuExtract(
  env: Env,
  rawExtract: string
): Promise<ParsedMenuCategory[] | null> {
  if (!aiEnabled(env) || !env.AI) return null;
  const trimmed = rawExtract.trim();
  if (!trimmed) return null;

  const model = env.AI_MENU_JUDGE_MODEL?.trim() || DEFAULT_MENU_JUDGE_MODEL;
  try {
    const judged = await runChatModel(
      env,
      model,
      [
        { role: "system", content: MENU_JUDGE_SYSTEM },
        { role: "user", content: buildMenuJudgeUserPrompt(trimmed) },
      ],
      4096,
      0
    );
    const categories = parseMenuImport(judged);
    return categories.length > 0 ? categories : null;
  } catch (err) {
    console.warn("menu judge failed", err);
    return null;
  }
}
