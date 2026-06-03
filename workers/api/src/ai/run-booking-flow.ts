import type { Lead } from "@lead-intake/shared-types";
import type { ProgrammeSchedule } from "../db/location-schedules";
import { confirmTrial, proposeTrial } from "../db/trial-booking";
import type { Env } from "../env";
import type { AiReply } from "./pipeline";
import {
  buildConfirmReply,
  buildNeedsDayReply,
  buildNeedsTimeReply,
  buildProposeReply,
  buildQuestionAnswerReply,
  hasScheduleQuestion,
  isAffirmativeBooking,
  isSoftAffirmation,
  needsDayClarification,
  resolveDayAndTime,
  resolveScheduleChoice,
} from "./booking-flow";
import { isWebsiteIntakePrompt } from "./intake-context";

type HistoryLine = { role: "lead" | "ai" | "staff"; text: string };

export async function runHumanBookingFlow(
  env: Env,
  leadId: string,
  lead: Lead,
  inboundText: string,
  schedule: ProgrammeSchedule | null,
  history: HistoryLine[] = []
): Promise<AiReply | null> {
  if (isWebsiteIntakePrompt(inboundText)) return null;
  if (!schedule?.slots.length) return null;

  if (
    lead.trialProposed &&
    !lead.trialSlot &&
    isAffirmativeBooking(inboundText)
  ) {
    const reply = buildConfirmReply(lead, lead.trialProposed);
    await confirmTrial(env, leadId, lead.trialProposed);
    return reply;
  }

  if (hasScheduleQuestion(inboundText)) {
    const reply = buildQuestionAnswerReply(lead, schedule, inboundText);
    if (reply.trialProposed) {
      await proposeTrial(env, leadId, reply.trialProposed);
    }
    return reply;
  }

  if (needsDayClarification(inboundText, schedule, history)) {
    const { time } = resolveDayAndTime(inboundText, schedule, history);
    if (time) {
      return buildNeedsDayReply(lead, schedule, time.displayLabel);
    }
  }

  const choice = resolveScheduleChoice(inboundText, schedule, history);
  if (choice && isAffirmativeBooking(inboundText)) {
    const reply = buildConfirmReply(lead, choice, {
      enthusiastic: isSoftAffirmation(inboundText),
    });
    await confirmTrial(env, leadId, choice);
    return reply;
  }

  if (choice) {
    const reply = buildProposeReply(lead, choice);
    await proposeTrial(env, leadId, choice);
    return reply;
  }

  const { day, time } = resolveDayAndTime(inboundText, schedule, history);
  if (day && !time) {
    const timesOnDay = [
      ...new Set(
        schedule.slots
          .filter((s) => s.day_of_week === day)
          .map((s) => s.start_time)
      ),
    ];
    if (timesOnDay.length > 1) {
      return buildNeedsTimeReply(lead, schedule, day);
    }
  }

  return null;
}
