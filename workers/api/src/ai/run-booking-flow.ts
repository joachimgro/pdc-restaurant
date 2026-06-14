import type { Lead } from "@lead-intake/shared-types";
import type { ProgrammeSchedule } from "../db/location-schedules";
import { confirmTrial, proposeTrial } from "../db/trial-booking";
import { getLead } from "../db/leads";
import type { Env } from "../env";
import { simpleSchedulingEnabled } from "../capabilities";
import { ensureLeadProgramme } from "./qualification";
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
  resolveAffirmativeBookingChoice,
  resolveLooseAffirmativeBookingChoice,
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
  if (!simpleSchedulingEnabled(env)) return null;

  if (isWebsiteIntakePrompt(inboundText)) return null;

  if (!schedule?.slots.length) {
    const loose = resolveLooseAffirmativeBookingChoice(inboundText, history);
    if (loose && !lead.trialSlot) {
      await ensureLeadProgramme(env, leadId, lead, { history });
      const refreshed = (await getLead(env, leadId)) ?? lead;
      const reply = buildConfirmReply(refreshed, loose, { history });
      const res = await confirmTrial(env, leadId, loose, { history });
      if (res.alreadyConfirmed) reply.skipSms = true;
      return reply;
    }
    return null;
  }

  const affirmativeChoice = resolveAffirmativeBookingChoice(
    inboundText,
    schedule,
    history
  );
  if (affirmativeChoice && !lead.trialSlot) {
    await ensureLeadProgramme(env, leadId, lead, { schedule, history });
    const refreshed = (await getLead(env, leadId)) ?? lead;
    const reply = buildConfirmReply(refreshed, affirmativeChoice, {
      enthusiastic: isSoftAffirmation(inboundText),
      schedule,
      history,
    });
    const res = await confirmTrial(env, leadId, affirmativeChoice, { schedule, history });
    if (res.alreadyConfirmed) reply.skipSms = true;
    return reply;
  }

  if (
    lead.trialProposed &&
    !lead.trialSlot &&
    isAffirmativeBooking(inboundText)
  ) {
    await ensureLeadProgramme(env, leadId, lead, { schedule, history });
    const refreshed = (await getLead(env, leadId)) ?? lead;
    const reply = buildConfirmReply(refreshed, lead.trialProposed, {
      schedule,
      history,
    });
    const res = await confirmTrial(env, leadId, lead.trialProposed, { schedule, history });
    if (res.alreadyConfirmed) reply.skipSms = true;
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
    await ensureLeadProgramme(env, leadId, lead, { schedule, history });
    const refreshed = (await getLead(env, leadId)) ?? lead;
    const reply = buildConfirmReply(refreshed, choice, {
      enthusiastic: isSoftAffirmation(inboundText),
      schedule,
      history,
    });
    const res = await confirmTrial(env, leadId, choice, { schedule, history });
    if (res.alreadyConfirmed) reply.skipSms = true;
    return reply;
  }

  if (choice) {
    await ensureLeadProgramme(env, leadId, lead, { schedule, history });
    const refreshed = (await getLead(env, leadId)) ?? lead;
    const reply = buildProposeReply(refreshed, choice, { schedule, history });
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
