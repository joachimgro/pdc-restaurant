import {
  AiGenerateOutputSchema,
  AiJudgeOutputSchema,
  type AiGenerateOutput,
  type AiJudgeOutput,
  parseJsonFromModel,
} from "./schema";

function tryParseJson(raw: string): unknown | null {
  try {
    return parseJsonFromModel(raw);
  } catch {
    return null;
  }
}

/** Model binding coerced an object to a useless plain string. */
function isInvalidPlainTextOutput(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  if (/^\[object \w+\]$/i.test(t)) return true;
  if (/^policy\s+updated\.?$/i.test(t)) return true;
  if (/^instructions?\s+updated\.?$/i.test(t)) return true;
  return false;
}

/** Tolerate Llama returning slightly invalid JSON or prose. */
export function parseGenerateOutput(
  raw: string,
  fallbackAssessment: string
): AiGenerateOutput | null {
  const trimmed = raw.trim();
  console.log(
    "parseGenerateOutput input (first 400 chars):",
    trimmed.slice(0, 400)
  );
  const parsed = tryParseJson(trimmed);

  if (parsed && typeof parsed === "object") {
    const relaxed = AiGenerateOutputSchema.safeParse(parsed);
    if (relaxed.success) return relaxed.data;

    const obj = parsed as Record<string, unknown>;
    if (typeof obj.reply === "string" && obj.reply.trim()) {
      return {
        reply: obj.reply.trim(),
        stage: typeof obj.stage === "string" ? obj.stage : "Discovery",
        note:
          typeof obj.note === "string"
            ? obj.note
            : "Generated reply (partial JSON parse).",
        assessment:
          typeof obj.assessment === "string"
            ? obj.assessment
            : fallbackAssessment,
        status:
          typeof obj.status === "string"
            ? (obj.status as AiGenerateOutput["status"])
            : "engaged",
        statusLabel:
          typeof obj.statusLabel === "string" ? obj.statusLabel : "Engaged",
      };
    }
  }

  if (
    trimmed &&
    !trimmed.startsWith("{") &&
    trimmed.length <= 400 &&
    !isInvalidPlainTextOutput(trimmed)
  ) {
    console.log("parseGenerateOutput: using plain-text fallback");
    return {
      reply: trimmed,
      stage: "Discovery",
      note: "Used plain-text model output (JSON parse failed).",
      assessment: fallbackAssessment,
      status: "engaged",
      statusLabel: "Engaged",
    };
  }

  console.warn("parseGenerateOutput: could not parse model output");
  return null;
}

export function parseJudgeOutput(
  raw: string
): AiJudgeOutput | null {
  const parsed = tryParseJson(raw.trim());
  if (!parsed) return null;

  const result = AiJudgeOutputSchema.safeParse(parsed);
  if (result.success) return result.data;

  const obj = parsed as Record<string, unknown>;
  if (typeof obj.verdict === "string" && typeof obj.note === "string") {
    return {
      verdict: obj.verdict as AiJudgeOutput["verdict"],
      stage: typeof obj.stage === "string" ? obj.stage : "Discovery",
      note: obj.note,
      finalReply:
        typeof obj.finalReply === "string" ? obj.finalReply : undefined,
    };
  }

  return null;
}
