import type { Env } from "../env";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** Pull assistant text from nested Workers AI / OpenAI-style payloads. */
function stringFromMessageLike(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return null;

  const o = value as Record<string, unknown>;

  if (typeof o.content === "string") return o.content;

  if (Array.isArray(o.content)) {
    const parts = o.content
      .map((part) => {
        if (typeof part === "string") return part;
        if (!part || typeof part !== "object") return "";
        const p = part as Record<string, unknown>;
        if (typeof p.text === "string") return p.text;
        if (typeof p.content === "string") return p.content;
        return "";
      })
      .filter(Boolean);
    if (parts.length > 0) return parts.join("");
  }

  if (typeof o.message === "string") return o.message;
  if (typeof o.text === "string") return o.text;
  if (typeof o.reply === "string") return o.reply;

  if (o.response !== undefined) {
    const nested = stringFromMessageLike(o.response);
    if (nested) return nested;
  }

  if (o.message && typeof o.message === "object") {
    const nested = stringFromMessageLike(o.message);
    if (nested) return nested;
  }

  return null;
}

export function extractModelText(result: unknown): string {
  if (typeof result === "string") return result;
  if (!result || typeof result !== "object") {
    return result == null ? "" : String(result);
  }

  const r = result as Record<string, unknown>;

  if (r.response !== undefined) {
    const fromResponse = stringFromMessageLike(r.response);
    if (fromResponse) return fromResponse;

    if (r.response && typeof r.response === "object") {
      const obj = r.response as Record<string, unknown>;
      if (
        typeof obj.reply === "string" ||
        typeof obj.stage === "string" ||
        typeof obj.verdict === "string"
      ) {
        return JSON.stringify(r.response);
      }
    }
  }

  if (typeof r.text === "string") return r.text;
  if (typeof r.description === "string") return r.description;

  if (Array.isArray(r.choices) && r.choices.length > 0) {
    const choice = r.choices[0] as Record<string, unknown>;
    if (choice.message) {
      const fromMsg = stringFromMessageLike(choice.message);
      if (fromMsg) return fromMsg;
    }
    if (typeof choice.text === "string") return choice.text;
  }

  const fromRoot = stringFromMessageLike(result);
  if (fromRoot) return fromRoot;

  console.warn(
    "extractModelText: unknown Workers AI shape",
    JSON.stringify(result).slice(0, 600)
  );
  return String(result);
}

export function aiEnabled(env: Env): boolean {
  if (env.AI_DISABLED === "true" || env.AI_DISABLED === "1") return false;
  return Boolean(env.AI);
}

export async function runChatModel(
  env: Env,
  model: string,
  messages: ChatMessage[],
  maxTokens = 512,
  temperature = 0.35
): Promise<string> {
  if (!env.AI) throw new Error("Workers AI binding not configured");

  const result = await env.AI.run(model, {
    messages,
    max_tokens: maxTokens,
    temperature,
  });

  return extractModelText(result);
}

export async function embedText(env: Env, text: string): Promise<number[]> {
  if (!env.AI) throw new Error("Workers AI binding not configured");

  const model =
    env.AI_EMBED_MODEL ?? "@cf/baai/bge-base-en-v1.5";

  const result = await env.AI.run(model, { text: text.slice(0, 2000) });

  if (result && typeof result === "object" && "data" in result) {
    const data = (result as { data: unknown }).data;
    if (Array.isArray(data) && data.length > 0) {
      if (Array.isArray(data[0])) return data[0] as number[];
      if (typeof data[0] === "number") return data as number[];
    }
  }

  if (Array.isArray(result) && typeof result[0] === "number") {
    return result;
  }

  throw new Error("Unexpected embedding response shape");
}
