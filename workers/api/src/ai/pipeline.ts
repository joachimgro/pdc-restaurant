import type { Reasoning, TrialProposal } from "@lead-intake/shared-types";
import { getLead } from "../db/leads";
import type { Env } from "../env";
import { loadScheduleForLead } from "../schedule-runtime";
import {
  buildConversationContext,
  buildStructuredHistoryForLlm,
} from "./context";
import { intakeContextLabelFromConfig } from "../db/ai-config";
import {
  isFirstWelcomeTurn,
  isWebsiteIntakePrompt,
  pickScheduleLine,
  welcomeReplyFromLead,
} from "./intake-context";
import { judgeReply } from "./judge";
import { buildCurrentTurnPrompt, buildSystemPrompt } from "./prompt";
import { handlePostBookingMessage } from "./post-booking";
import {
  checkTopic,
  injectionDeflectionReply,
  looksLikeInjectionCompliance,
} from "./topic-guard";
import {
  buildRagQuery,
  ragEnabled,
  retrieveKnowledge,
} from "./rag";
import { parseGenerateOutput } from "./parse-output";
import {
  applyTemplateTokens,
  filterKnowledgeForReply,
  looksLikeBrokenFollowUp,
  looksLikeHealthyFollowUp,
} from "./reply-postprocess";
import {
  buildConfirmReply,
  buildProposeReply,
  detectBookingIntentInReply,
  extractSlotFromReplyContext,
  isAffirmativeBooking,
  isSoftAffirmation,
  extractLooseSlotFromReplyContext,
  resolveAffirmativeBookingChoice,
  resolveLooseAffirmativeBookingChoice,
  resolveScheduleChoice,
} from "./booking-flow";
import { confirmTrial, proposeTrial } from "../db/trial-booking";
import { runHumanBookingFlow } from "./run-booking-flow";
import { stubReplyForOlivia, stubReplyFromLead } from "./stub";
import { aiEnabled, runChatModel, type ChatMessage } from "./workers-ai";
import { handleQualificationTurn, learnFromMessage, needsQualification } from "./qualification";
import { extractProgrammeFromText } from "./programme-resolve";
import type { Lead } from "@lead-intake/shared-types";
import type { ProgrammeSchedule } from "../db/location-schedules";

function replyUsesWrongProgramme(text: string, lead: Lead): boolean {
  if (!lead.interest || lead.interest === "Unknown") return false;
  const mentioned = extractProgrammeFromText(text);
  return Boolean(mentioned && mentioned !== lead.interest);
}

function structuredBookingOverride(
  lead: Lead,
  inboundText: string,
  history: { role: string; text: string }[],
  schedule: ProgrammeSchedule | null
) {
  if (schedule?.slots.length) {
    return (
      extractSlotFromReplyContext("", schedule, history) ??
      resolveAffirmativeBookingChoice(inboundText, schedule, history)
    );
  }
  return (
    resolveLooseAffirmativeBookingChoice(inboundText, history) ??
    extractLooseSlotFromReplyContext("", history)
  );
}

export interface AiReply {
  text: string;
  reasoning: Reasoning;
  assessment?: string;
  preview?: string;
  status?: string;
  statusLabel?: string;
  smsText?: string;
  skipSms?: boolean;
  trialSlot?: string;
  trialSlotLabel?: string;
  trialProposed?: TrialProposal;
}

export async function generateAiReply(
  env: Env,
  leadId: string,
  inboundText: string
): Promise<AiReply> {
  if (leadId === "olivia") {
    return stubReplyForOlivia();
  }

  const leadForRag = await getLead(env, leadId);
  if (!leadForRag) {
    return stubReplyFromLead(null, inboundText, []);
  }

  const dbSchedule = await loadScheduleForLead(env, leadForRag);

  const queryText = buildRagQuery(
    inboundText,
    leadForRag.interest,
    leadForRag.location,
    leadForRag.locationId
  );

  const knowledgeChunks = ragEnabled(env)
    ? await retrieveKnowledge(
        env,
        env.ORGANIZATION_ID,
        leadForRag.locationId,
        queryText
      )
    : [];

  const scheduleLine = pickScheduleLine(
    leadForRag,
    knowledgeChunks,
    dbSchedule
  );

  const ctx = await buildConversationContext(
    env,
    leadId,
    inboundText,
    scheduleLine,
    dbSchedule
  );
  if (!ctx) {
    return stubReplyFromLead(leadForRag, inboundText, [], scheduleLine, dbSchedule);
  }

  if (isFirstWelcomeTurn(ctx.lead, inboundText, ctx.history)) {
    const { text } = welcomeReplyFromLead(
      ctx.lead,
      scheduleLine,
      dbSchedule
    );
    return {
      text,
      reasoning: {
        verdict: "Approved",
        stage: "Discovery",
        note: `Welcome SMS from form: ${ctx.lead.interest} at ${ctx.lead.location}.`,
      },
      assessment: "Welcome sent — free trial offered",
      preview: text.slice(0, 53) + (text.length > 53 ? "..." : ""),
      status: "engaged",
      statusLabel: "Engaged",
    };
  }

  if (needsQualification(ctx.lead)) {
    const qualReply = await handleQualificationTurn(
      env,
      ctx.lead,
      inboundText,
      ctx.history
    );
    if (qualReply) return qualReply;
  }

  if (
    ctx.lead.status === "booked" &&
    (ctx.lead.trialConfirmedAt ||
      ctx.lead.trialSlotLabel ||
      ctx.lead.trialSlot)
  ) {
    return handlePostBookingMessage(env, ctx, inboundText);
  }

  const topicCheck = checkTopic({
    inboundText,
    lead: ctx.lead,
    history: ctx.history,
  });
  if (!topicCheck.onTopic && topicCheck.deflectionReply) {
    const text = topicCheck.deflectionReply;
    return {
      text,
      reasoning: {
        verdict: "Deflected",
        stage: topicCheck.deflectionStage ?? "Off-topic",
        note: topicCheck.reason,
      },
      status: ctx.lead.status,
      statusLabel: ctx.lead.statusLabel,
      assessment: ctx.lead.assessment,
      preview: text.slice(0, 53) + (text.length > 53 ? "..." : ""),
      skipSms: false,
    };
  }

  // Silently update the lead profile with anything we can learn from this message.
  // Runs regardless of which flow handles the reply (booking, LLM, etc.).
  await learnFromMessage(env, ctx.lead, inboundText, ctx.history);

  const bookingReply = await runHumanBookingFlow(
    env,
    leadId,
    ctx.lead,
    inboundText,
    dbSchedule,
    ctx.history
  );
  if (bookingReply) {
    return bookingReply;
  }

  if (dbSchedule?.slots.length) {
    const choice = resolveScheduleChoice(
      inboundText,
      dbSchedule,
      ctx.history
    );
    if (choice) {
      if (isAffirmativeBooking(inboundText)) {
        await confirmTrial(env, leadId, choice, {
          schedule: dbSchedule,
          history: ctx.history,
        });
        const refreshed = (await getLead(env, leadId)) ?? ctx.lead;
        return buildConfirmReply(refreshed, choice, {
          enthusiastic: isSoftAffirmation(inboundText),
          schedule: dbSchedule,
          history: ctx.history,
        });
      }
      await proposeTrial(env, leadId, choice);
      const refreshed = (await getLead(env, leadId)) ?? ctx.lead;
      return buildProposeReply(refreshed, choice, {
        schedule: dbSchedule,
        history: ctx.history,
      });
    }
  }

  if (!aiEnabled(env)) {
    console.warn("generateAiReply: AI disabled — using stub", {
      leadId,
      AI_DISABLED: env.AI_DISABLED,
      hasBinding: !!env.AI,
    });
    return stubReplyFromLead(
      ctx.lead,
      inboundText,
      ctx.history,
      scheduleLine,
      dbSchedule
    );
  }

  const replyKnowledge = filterKnowledgeForReply(knowledgeChunks);

  try {
    const structuredHistory = buildStructuredHistoryForLlm(
      ctx.history,
      inboundText,
      intakeContextLabelFromConfig(ctx.aiConfig)
    );
    const messages: ChatMessage[] = [
      {
        role: "system",
        content: buildSystemPrompt(
          ctx.aiConfig,
          ctx.locationOverride,
          replyKnowledge,
          ctx.intakeContextBlock
        ),
      },
      ...structuredHistory,
      {
        role: "user",
        content: buildCurrentTurnPrompt(ctx, inboundText),
      },
    ];

    console.log("AI binding exists:", !!env.AI);
    console.log("About to call model:", ctx.aiConfig.model_reply);
    console.log(
      "LLM message roles:",
      messages.map((m) => m.role).join(" → ")
    );

    const raw = await runChatModel(
      env,
      ctx.aiConfig.model_reply,
      messages,
      512,
      0.55
    );

    console.log(
      "Raw LLM response (first 500 chars):",
      typeof raw === "string" ? raw.slice(0, 500) : JSON.stringify(raw).slice(0, 500)
    );

    const generated = parseGenerateOutput(
      raw,
      ctx.lead.assessment || "AI engaging"
    );
    if (!generated) {
      if (looksLikeInjectionCompliance(raw, inboundText)) {
        const blocked = injectionDeflectionReply({
          inboundText,
          lead: ctx.lead,
          history: ctx.history,
        });
        const text = blocked.deflectionReply!;
        return {
          text,
          reasoning: {
            verdict: "Deflected",
            stage: blocked.deflectionStage ?? "Injection blocked",
            note: "Model complied with injection — blocked.",
          },
          status: ctx.lead.status,
          statusLabel: ctx.lead.statusLabel,
          assessment: ctx.lead.assessment,
          preview: text.slice(0, 53) + (text.length > 53 ? "..." : ""),
          skipSms: false,
        };
      }
      throw new Error("Could not parse model output");
    }
    const proposed = generated.reply.trim();

    if (looksLikeInjectionCompliance(proposed, inboundText)) {
      const blocked = injectionDeflectionReply({
        inboundText,
        lead: ctx.lead,
        history: ctx.history,
      });
      const text = blocked.deflectionReply!;
      return {
        text,
        reasoning: {
          verdict: "Deflected",
          stage: blocked.deflectionStage ?? "Injection blocked",
          note: "Model complied with injection — blocked.",
        },
        status: ctx.lead.status,
        statusLabel: ctx.lead.statusLabel,
        assessment: ctx.lead.assessment,
        preview: text.slice(0, 53) + (text.length > 53 ? "..." : ""),
        skipSms: false,
      };
    }

    const skipJudgeLlm =
      generated.note.includes("plain-text") &&
      looksLikeHealthyFollowUp(proposed, inboundText, ctx.history);

    let judged = skipJudgeLlm
      ? {
          text: proposed,
          smsText: proposed,
          skipSms: false,
          reasoning: {
            verdict: "Approved" as const,
            stage: generated.stage,
            note: `${generated.note} (judge skipped — contextual plain-text)`,
          },
        }
      : await judgeReply(
          env,
          ctx.aiConfig,
          proposed,
          replyKnowledge,
          generated.stage,
          generated.note
        );

    let finalText = applyTemplateTokens(
      judged.text,
      ctx.lead,
      scheduleLine
    );

    const proposedFinal = applyTemplateTokens(
      proposed,
      ctx.lead,
      scheduleLine
    );
    if (
      looksLikeBrokenFollowUp(finalText, ctx.history) &&
      !looksLikeBrokenFollowUp(proposedFinal, ctx.history)
    ) {
      console.warn(
        "generateAiReply: judge rewrite looked like reset — using proposed",
        { leadId, judgePreview: finalText.slice(0, 80) }
      );
      finalText = proposedFinal;
      judged.reasoning = {
        verdict: "Approved",
        stage: generated.stage,
        note: "Proposed reply kept (judge rewrite discarded as off-thread reset).",
      };
      judged.text = proposed;
      judged.smsText = proposed;
    }

    if (looksLikeInjectionCompliance(finalText, inboundText)) {
      const blocked = injectionDeflectionReply({
        inboundText,
        lead: ctx.lead,
        history: ctx.history,
      });
      const text = blocked.deflectionReply!;
      return {
        text,
        reasoning: {
          verdict: "Deflected",
          stage: blocked.deflectionStage ?? "Injection blocked",
          note: "Judge/rewrite complied with injection — blocked.",
        },
        status: ctx.lead.status,
        statusLabel: ctx.lead.statusLabel,
        assessment: ctx.lead.assessment,
        preview: text.slice(0, 53) + (text.length > 53 ? "..." : ""),
        skipSms: false,
      };
    }

    if (looksLikeBrokenFollowUp(finalText, ctx.history)) {
      console.warn("generateAiReply: broken follow-up detected — using stub", {
        leadId,
        preview: finalText.slice(0, 80),
      });
      return stubReplyFromLead(
        ctx.lead,
        inboundText,
        ctx.history,
        scheduleLine,
        dbSchedule
      );
    }

    // LLM picked the wrong class (common on form leads) — use structured confirm instead.
    if (
      dbSchedule?.slots.length &&
      replyUsesWrongProgramme(finalText, ctx.lead)
    ) {
      const slot = structuredBookingOverride(
        ctx.lead,
        inboundText,
        ctx.history,
        dbSchedule
      );
      if (slot) {
        await confirmTrial(env, leadId, slot, {
          schedule: dbSchedule,
          history: ctx.history,
        });
        const refreshed = (await getLead(env, leadId)) ?? ctx.lead;
        return buildConfirmReply(refreshed, slot, {
          schedule: dbSchedule,
          history: ctx.history,
        });
      }
    }

    // Post-LLM: if the reply contains booking language, back it with a real DB write.
    const bookingIntent = detectBookingIntentInReply(finalText);
    if (bookingIntent) {
      const slot =
        ctx.lead.trialProposed ??
        (dbSchedule?.slots.length
          ? extractSlotFromReplyContext(finalText, dbSchedule, ctx.history)
          : extractLooseSlotFromReplyContext(finalText, ctx.history)) ??
        structuredBookingOverride(
          ctx.lead,
          inboundText,
          ctx.history,
          dbSchedule
        );
      if (slot) {
          if (bookingIntent === "confirm") {
            await confirmTrial(env, leadId, slot, {
              schedule: dbSchedule,
              history: ctx.history,
            });
            const refreshed = (await getLead(env, leadId)) ?? ctx.lead;
            if (replyUsesWrongProgramme(finalText, ctx.lead)) {
              return buildConfirmReply(refreshed, slot, {
                schedule: dbSchedule,
                history: ctx.history,
              });
            }
            const bookedText = applyTemplateTokens(finalText, refreshed, scheduleLine);
            return {
              text: bookedText,
              smsText: judged.smsText
                ? applyTemplateTokens(judged.smsText, refreshed, scheduleLine)
                : bookedText,
              skipSms: judged.skipSms,
              reasoning: {
                ...judged.reasoning,
                note: `${judged.reasoning.note} [booking confirmed from LLM reply]`,
              },
              assessment: `Trial booked — ${slot.label}`,
              preview: `Free trial · ${slot.label} · ${ctx.lead.location}`,
              status: "booked",
              statusLabel: "Booked",
              trialSlot: slot.slotId,
              trialSlotLabel: slot.label,
              trialProposed: slot,
            };
          } else {
            await proposeTrial(env, leadId, slot);
            return {
              text: finalText,
              smsText: judged.smsText
                ? applyTemplateTokens(judged.smsText, ctx.lead, scheduleLine)
                : finalText,
              skipSms: judged.skipSms,
              reasoning: {
                ...judged.reasoning,
                note: `${judged.reasoning.note} [trial proposed from LLM reply]`,
              },
              assessment: `Trial proposed — ${slot.label}`,
              preview: `Trial · ${slot.label} · awaiting yes`,
              status: "qualified",
              statusLabel: "Qualified",
              trialProposed: slot,
            };
          }
        }
    }

    const preview =
      finalText.slice(0, 53) + (finalText.length > 53 ? "..." : "");

    return {
      text: finalText,
      smsText: judged.smsText
        ? applyTemplateTokens(judged.smsText, ctx.lead, scheduleLine)
        : finalText,
      skipSms: judged.skipSms,
      reasoning: judged.reasoning,
      assessment: generated.assessment,
      preview,
      status: generated.status ?? "engaged",
      statusLabel: generated.statusLabel ?? "Engaged",
    };
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    console.error("LLM CALL FAILED:", err.message, err.stack);
    console.error("Workers AI pipeline failed, using stub", {
      leadId,
      error: err.message,
    });
    return stubReplyFromLead(
      ctx.lead,
      inboundText,
      ctx.history,
      scheduleLine,
      dbSchedule
    );
  }
}
