import type { Reasoning } from "@lead-intake/shared-types";
import type { KnowledgeChunk } from "@lead-intake/knowledge";
import type { Env } from "../env";
import type { AiConfigRow } from "../db/ai-config";
import { parseJudgeOutput } from "./parse-output";
import { SMS_SAFE_FALLBACK } from "./stub";
import {
  buildJudgeSystemPrompt,
  buildJudgeUserPrompt,
} from "./prompt";
import { aiEnabled, runChatModel } from "./workers-ai";

const MAX_SMS_LEN = 320;

export interface JudgeResult {
  text: string;
  reasoning: Reasoning;
  smsText: string;
  skipSms: boolean;
}

function ruleBasedChecks(
  reply: string,
  knowledgeChunks: KnowledgeChunk[]
): { hold: boolean; reason: string } {
  if (reply.length > MAX_SMS_LEN) {
    return { hold: true, reason: `Reply exceeds ${MAX_SMS_LEN} characters` };
  }

  const medical =
    /\b(injury|diagnose|prescription|doctor|broken bone|sprain treatment)\b/i;
  if (medical.test(reply)) {
    return { hold: true, reason: "Possible medical advice" };
  }

  const priceMatch = reply.match(/£\s?\d+/g);
  if (priceMatch && knowledgeChunks.length > 0) {
    const corpus = knowledgeChunks.map((c) => c.text).join(" ");
    for (const p of priceMatch) {
      const normalized = p.replace(/\s/g, "");
      const amount = normalized.replace(/[^\d]/g, "");
      const inCorpus =
        corpus.includes(normalized) ||
        (amount.length > 0 && corpus.includes(amount));
      if (!inCorpus) {
        return {
          hold: true,
          reason: `Price ${p} not found in retrieved knowledge`,
        };
      }
    }
  }

  return { hold: false, reason: "" };
}

export async function judgeReply(
  env: Env,
  config: AiConfigRow,
  proposedReply: string,
  knowledgeChunks: KnowledgeChunk[],
  generateStage: string,
  generateNote: string
): Promise<JudgeResult> {
  const rulesCheck = ruleBasedChecks(proposedReply, knowledgeChunks);
  if (rulesCheck.hold) {
    console.warn("Judge rule hold", {
      reason: rulesCheck.reason,
      replyPreview: proposedReply.slice(0, 120),
    });
    return {
      text: SMS_SAFE_FALLBACK,
      smsText: SMS_SAFE_FALLBACK,
      skipSms: false,
      reasoning: {
        verdict: "Hold",
        stage: generateStage,
        note: `Rule check: ${rulesCheck.reason}. ${generateNote}`,
      },
    };
  }

  if (!aiEnabled(env)) {
    return {
      text: proposedReply,
      smsText: proposedReply,
      skipSms: false,
      reasoning: {
        verdict: "Approved",
        stage: generateStage,
        note: generateNote,
      },
    };
  }

  try {
    const raw = await runChatModel(
      env,
      config.model_judge,
      [
        {
          role: "system",
          content: buildJudgeSystemPrompt(config.rules),
        },
        {
          role: "user",
          content: buildJudgeUserPrompt(proposedReply, knowledgeChunks),
        },
      ],
      256,
      0.2
    );

    const parsed = parseJudgeOutput(raw);
    if (!parsed) throw new Error("Could not parse judge output");
    const final =
      parsed.verdict === "Rewrite" && parsed.finalReply
        ? parsed.finalReply.slice(0, MAX_SMS_LEN)
        : proposedReply.slice(0, MAX_SMS_LEN);

    if (parsed.verdict === "Hold") {
      if (parsed.finalReply) {
        const rewritten = parsed.finalReply.slice(0, MAX_SMS_LEN);
        const rewriteCheck = ruleBasedChecks(rewritten, knowledgeChunks);
        if (!rewriteCheck.hold) {
          return {
            text: rewritten,
            smsText: rewritten,
            skipSms: false,
            reasoning: {
              verdict: "Rewrite",
              stage: parsed.stage,
              note: parsed.note,
            },
          };
        }
      }

      // Judge flagged caution but reply passes hard rules — send it (avoid generic dead-end)
      console.warn("Judge LLM Hold overridden — reply passed rules", {
        note: parsed.note,
        replyPreview: proposedReply.slice(0, 120),
      });
      return {
        text: proposedReply.slice(0, MAX_SMS_LEN),
        smsText: proposedReply.slice(0, MAX_SMS_LEN),
        skipSms: false,
        reasoning: {
          verdict: "Approved",
          stage: parsed.stage || generateStage,
          note: `Auto-approved (judge suggested Hold: ${parsed.note})`,
        },
      };
    }

    const recheck = ruleBasedChecks(final, knowledgeChunks);
    if (recheck.hold) {
      return {
        text: SMS_SAFE_FALLBACK,
        smsText: SMS_SAFE_FALLBACK,
        skipSms: false,
        reasoning: {
          verdict: "Hold",
          stage: parsed.stage,
          note: `${parsed.note} (${recheck.reason})`,
        },
      };
    }

    return {
      text: final,
      smsText: final,
      skipSms: false,
      reasoning: {
        verdict: parsed.verdict,
        stage: parsed.stage,
        note: parsed.note,
      },
    };
  } catch (e) {
    console.error("Judge model failed, using rule-only", e);
    return {
      text: proposedReply.slice(0, MAX_SMS_LEN),
      smsText: proposedReply.slice(0, MAX_SMS_LEN),
      skipSms: false,
      reasoning: {
        verdict: "Approved",
        stage: generateStage,
        note: `${generateNote} (judge fallback)`,
      },
    };
  }
}
