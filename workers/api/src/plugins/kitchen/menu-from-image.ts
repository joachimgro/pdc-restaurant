import { aiEnabled, extractModelText } from "../../ai/workers-ai";
import type { Env } from "../../env";
import { judgeMenuExtract } from "./menu-judge";
import {
  categoriesToImportJson,
  parseMenuImport,
  type ParsedMenuCategory,
} from "./menu-import";

const DEFAULT_VISION_MODELS = [
  "@cf/meta/llama-4-scout-17b-16e-instruct",
  "@cf/meta/llama-3.2-11b-vision-instruct",
  "@cf/llava-hf/llava-1.5-7b-hf",
] as const;

const MENU_TRANSCRIBE_PROMPT = `This image is a restaurant menu photo. Transcribe EVERY readable dish.

Output markdown:
## Section name
Dish name - £price
optional ingredient line under the dish

Rules:
- Keep printed section headers (STARTERS, SHARING BOARD, MEATS, SIDES, VEGETARIAN, DESSERTS, etc.).
- Put the price on the same line as the dish name, using £.
- If a dish wraps onto a second ingredient line, keep that line under the dish (do not make it a new dish).
- Ignore the giant vertical restaurant-name watermark, botanical drawings, allergen notes, and service-charge footers.
- Do not invent dishes. If a price is unreadable, still include the dish without a price.
- Do not output JSON. Do not add commentary.`;

function uint8ToBase64(bytes: Uint8Array): string {
  const chunk = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function visionModels(env: Env): string[] {
  const override = env.AI_VISION_MODEL?.trim();
  if (override) {
    return [override, ...DEFAULT_VISION_MODELS.filter((m) => m !== override)];
  }
  return [...DEFAULT_VISION_MODELS];
}

type VisionPayload = Record<string, unknown>;

function looksLikeMenuTranscript(text: string): boolean {
  if (text.length < 40) return false;
  if (
    /i('m| am) (sorry|unable)|cannot (see|read|process) (the )?image/i.test(
      text
    )
  ) {
    return false;
  }
  if (/£\s*\d/.test(text)) return true;
  if (/#{1,3}\s+\S/.test(text)) return true;
  if (
    /\b(starters?|mains?|desserts?|sides?|sharing board|vegetarian)\b/i.test(
      text
    )
  ) {
    return true;
  }
  return (text.match(/\d+(?:\.\d{2})/g) ?? []).length >= 3;
}

async function runVisionModel(
  env: Env,
  model: string,
  payload: VisionPayload
): Promise<unknown> {
  const ai = env.AI as {
    run: (model: string, inputs: unknown) => Promise<unknown>;
  };
  return ai.run(model, payload);
}

function visionPayloads(
  model: string,
  imageBytes: Uint8Array,
  prompt: string
): VisionPayload[] {
  const b64 = uint8ToBase64(imageBytes);
  const dataUrl = `data:image/jpeg;base64,${b64}`;
  const system = "You transcribe restaurant menus exactly. No commentary.";

  if (model.includes("llava")) {
    return [
      { prompt, image: Array.from(imageBytes), max_tokens: 4096 },
      {
        prompt,
        image: b64,
        max_tokens: 4096,
      },
    ];
  }

  return [
    {
      messages: [
        { role: "system", content: system },
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: dataUrl } },
          ],
        },
      ],
      max_tokens: 4096,
      temperature: 0,
    },
    {
      messages: [
        { role: "system", content: system },
        { role: "user", content: prompt },
      ],
      image: b64,
      max_tokens: 4096,
      temperature: 0,
    },
  ];
}

async function runVisionTranscribe(
  env: Env,
  imageBytes: Uint8Array
): Promise<string> {
  if (!env.AI) throw new Error("Workers AI binding not configured");

  const errors: string[] = [];
  for (const model of visionModels(env)) {
    for (const payload of visionPayloads(model, imageBytes, MENU_TRANSCRIBE_PROMPT)) {
      try {
        const result = await runVisionModel(env, model, payload);
        const text = extractModelText(result).trim();
        if (looksLikeMenuTranscript(text)) {
          console.log("menu vision transcribe ok", {
            model,
            chars: text.length,
          });
          return text;
        }
        if (text) {
          errors.push(
            `${model}: not a menu transcript (${text.slice(0, 80)})`
          );
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push(`${model}: ${message}`);
      }
    }
  }

  throw new Error(
    errors.length > 0
      ? `Vision models failed (${errors.slice(0, 3).join("; ")})`
      : "Vision model returned no text"
  );
}

function pickRicherMenu(
  judged: ParsedMenuCategory[] | null,
  fallback: ParsedMenuCategory[]
): ParsedMenuCategory[] {
  const judgedCount =
    judged?.reduce((n, c) => n + c.items.length, 0) ?? 0;
  const fallbackCount = fallback.reduce((n, c) => n + c.items.length, 0);
  if (judged && judgedCount > 0 && judgedCount >= fallbackCount * 0.6) {
    return judged;
  }
  return fallback.length > 0 ? fallback : judged ?? [];
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

  const rawModelText = await runVisionTranscribe(env, imageBytes);
  let fallback: ParsedMenuCategory[] = [];
  try {
    fallback = parseMenuImport(rawModelText);
  } catch {
    fallback = [];
  }

  const judged = await judgeMenuExtract(env, rawModelText);
  const categories = pickRicherMenu(judged, fallback);

  if (categories.length === 0) {
    throw new Error(
      "Could not read a menu from that photo. Try a clearer shot, or paste the menu as text."
    );
  }

  return {
    text: categoriesToImportJson(categories),
    categories,
    rawModelText,
  };
}
