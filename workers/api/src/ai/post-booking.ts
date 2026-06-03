import type { ConversationContext } from "./context";
import type { Env } from "../env";
import { parseGenerateOutput } from "./parse-output";
import type { AiReply } from "./pipeline";
import { checkTopic } from "./topic-guard";
import { aiEnabled, runChatModel } from "./workers-ai";

function previewText(text: string): string {
  return text.slice(0, 53) + (text.length > 53 ? "..." : "");
}

function trialLabel(ctx: ConversationContext): string {
  const lead = ctx.lead;
  return (
    lead.trialSlotLabel ||
    lead.trialProposed?.label ||
    "your upcoming trial"
  );
}

function deflectionFromTopic(
  ctx: ConversationContext,
  inboundText: string
): AiReply | null {
  const topic = checkTopic({
    inboundText,
    lead: ctx.lead,
    history: ctx.history,
  });
  if (topic.onTopic || !topic.deflectionReply) return null;

  const text = topic.deflectionReply;
  return {
    text,
    reasoning: {
      verdict: "Deflected",
      stage: topic.deflectionStage ?? "Off-topic",
      note: topic.reason,
    },
    status: "booked",
    statusLabel: "Booked",
    assessment: ctx.lead.assessment || `Booked — ${trialLabel(ctx)}`,
    preview: previewText(text),
    skipSms: false,
  };
}

const ACK_PATTERNS = [
  /^(thanks|thank you|cheers|ta|great|perfect|lovely|cool|ok|okay|sure|see you|👍|🙏|❤️)/i,
  /^(are you still there|hello|hi|hey)\??$/i,
];

const CANCEL_SIGNALS =
  /\b(cancel|can't make it|cannot make it|not coming|change|reschedule|different day|different time)\b/i;

export async function handlePostBookingMessage(
  env: Env,
  ctx: ConversationContext,
  inboundText: string
): Promise<AiReply> {
  const lead = ctx.lead;
  const label = trialLabel(ctx);
  const assessment = lead.assessment || `Booked — ${label}`;

  const deflected = deflectionFromTopic(ctx, inboundText);
  if (deflected) return deflected;

  const lower = inboundText.toLowerCase().trim();

  if (ACK_PATTERNS.some((r) => r.test(lower))) {
    const text = `All sorted — ${label}. See you there! If anything changes just text back.`;
    return {
      text,
      reasoning: {
        verdict: "Approved",
        stage: "Post-booking",
        note: "Lead already booked. Acknowledged their message without re-pitching.",
      },
      status: "booked",
      statusLabel: "Booked",
      assessment,
      preview: previewText(text),
      skipSms: false,
    };
  }

  if (CANCEL_SIGNALS.test(lower)) {
    const text =
      "No problem at all — want to pick a different day? Just let me know what works and I'll rebook you.";
    return {
      text,
      reasoning: {
        verdict: "Approved",
        stage: "Post-booking",
        note: "Lead wants to change/cancel. Offered reschedule without losing them.",
      },
      status: "engaged",
      statusLabel: "Engaged",
      assessment: "Rescheduling — was booked",
      preview: previewText(text),
      skipSms: false,
    };
  }

  const logisticsFallback = `You're all set for ${label}! If you have any questions about what to bring or expect, just ask.`;

  if (!aiEnabled(env)) {
    return {
      text: logisticsFallback,
      reasoning: {
        verdict: "Approved",
        stage: "Post-booking",
        note: "AI disabled — post-booking logistics fallback",
      },
      status: "booked",
      statusLabel: "Booked",
      assessment,
      preview: previewText(logisticsFallback),
      skipSms: false,
    };
  }

  const postBookingSystemPrompt = `You are the SMS assistant for ${ctx.aiConfig.academy_name}.
The lead "${lead.name}" is ALREADY BOOKED for ${label}.

CRITICAL RULES:
- Do NOT offer a trial — they already have one booked.
- Do NOT ask about days, times, programmes, or interest — already confirmed.
- Do NOT pitch or sell anything.
- Answer their specific question if it's about logistics (what to wear, where to go, parking, what to expect).
- If the question is completely unrelated to martial arts, politely redirect: "Good question but not my area! Anything else about ${label}?"
- Keep it short, warm, human. One or two sentences max.

Respond with JSON only:
{
  "reply": "SMS text",
  "stage": "Post-booking",
  "note": "What you understood",
  "assessment": "Booked — ${label}",
  "status": "booked",
  "statusLabel": "Booked"
}`;

  const raw = await runChatModel(
    env,
    ctx.aiConfig.model_reply,
    [
      { role: "system", content: postBookingSystemPrompt },
      {
        role: "user",
        content: `Their message: "${inboundText}"\n\nRespond with JSON only.`,
      },
    ],
    256,
    0.3
  );

  const parsed = parseGenerateOutput(raw, assessment);
  if (parsed?.reply) {
    const text = parsed.reply.trim();
    return {
      text,
      reasoning: {
        verdict: "Approved",
        stage: "Post-booking",
        note: parsed.note || "Post-booking question handled",
      },
      status: "booked",
      statusLabel: "Booked",
      assessment: parsed.assessment || assessment,
      preview: previewText(text),
      skipSms: false,
    };
  }

  return {
    text: logisticsFallback,
    reasoning: {
      verdict: "Approved",
      stage: "Post-booking",
      note: "Fallback — couldn't parse LLM response for post-booking question",
    },
    status: "booked",
    statusLabel: "Booked",
    assessment,
    preview: previewText(logisticsFallback),
    skipSms: false,
  };
}
