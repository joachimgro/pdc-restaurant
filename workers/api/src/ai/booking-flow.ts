import type { Lead, TrialProposal } from "@lead-intake/shared-types";
import type { ProgrammeSchedule } from "../db/location-schedules";
import {
  formatDaysPhrase,
  uniqueDaysFromSlots,
} from "../db/location-schedules";
import { displayFirstName } from "./intake-context";
import type { AiReply } from "./pipeline";

const DAY_ALIASES: Record<string, string> = {
  monday: "mon",
  mon: "mon",
  tuesday: "tue",
  tue: "tue",
  wednesday: "wed",
  wed: "wed",
  thursday: "thu",
  thu: "thu",
  friday: "fri",
  fri: "fri",
  saturday: "sat",
  sat: "sat",
  sunday: "sun",
  sun: "sun",
};

export const DAY_LABELS: Record<string, string> = {
  mon: "Monday",
  tue: "Tuesday",
  wed: "Wednesday",
  thu: "Thursday",
  fri: "Friday",
  sat: "Saturday",
  sun: "Sunday",
};

export function hasQuestion(text: string): boolean {
  const t = text.toLowerCase();
  if (t.includes("?")) return true;
  return (
    /\bevery\s*day\b/.test(t) ||
    /\beveryday\b/.test(t) ||
    /\bwhich\s+days?\b/.test(t) ||
    /\bwhat\s+days?\b/.test(t) ||
    /\bwhen\s+are\b/.test(t) ||
    /\bdo\s+you\s+run\b/.test(t) ||
    /\bavailable\b/.test(t) && /\bday/.test(t)
  );
}

export function isExplicitConfirmation(text: string): boolean {
  const t = text.toLowerCase().trim();
  return (
    /^(yes|yeah|yep|sure|ok|okay|please|book it|go ahead|sounds good|perfect|that works|do it|book me in|lock it in|let'?s do it)\b/.test(
      t
    ) ||
    /\b(yes please|book that|pencil it in|that'?s fine|that works for me|works for me)\b/.test(t)
  );
}

/** "sounds great", "amazing", "that would be great", etc. anywhere in the message */
export function isSoftAffirmation(text: string): boolean {
  const t = text.toLowerCase();
  return (
    /\b(sounds good|sounds great|that works|that'?d be great|that would be great|perfect|lovely|brilliant|awesome|great|amazing|fantastic|fab|fabulous|wicked|love it|ideal|class|mint|nice one|happy with that|stoked|excited|can'?t wait|go for it|let'?s go|works for me|suits me)\b/.test(
      t
    ) && !hasQuestion(text)
  );
}

export function isAffirmativeBooking(text: string): boolean {
  return isExplicitConfirmation(text) || isSoftAffirmation(text);
}

export function parseDayPreference(text: string): string | null {
  const t = text.toLowerCase();
  if (/\btomorrow\b/.test(t)) {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    const codes = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
    return codes[d.getDay()] ?? null;
  }
  if (/\btoday\b/.test(t)) {
    const codes = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
    return codes[new Date().getDay()] ?? null;
  }
  for (const [key, code] of Object.entries(DAY_ALIASES)) {
    if (new RegExp(`\\b${key}\\b`).test(t)) return code;
  }
  return null;
}

export function parseTimeFromSchedule(
  text: string,
  schedule: ProgrammeSchedule
): { startTime: string; displayLabel: string } | null {
  const t = text.toLowerCase().replace(/\s+/g, " ");
  const labels = [
    ...new Set(schedule.slots.map((s) => s.display_label.toLowerCase())),
  ];

  for (const label of labels) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`\\b${escaped.replace(/\./g, "[.:]?")}\\b`).test(t)) {
      const slot = schedule.slots.find(
        (s) => s.display_label.toLowerCase() === label
      );
      if (slot) {
        return {
          startTime: slot.start_time,
          displayLabel: slot.display_label,
        };
      }
    }
  }

  // 7.30pm / 7:30 PM — \b after minutes fails before "pm" (e.g. "7.30pm")
  if (/\b7[:\.]?30\s*(?:pm)?\b/i.test(t) || /\b730\s*(?:pm)?\b/i.test(t)) {
    return matchTime(schedule, "19:30");
  }
  if (/\b8[:\.]?30\s*(?:pm)?\b/i.test(t) || /\b830\s*(?:pm)?\b/i.test(t)) {
    return matchTime(schedule, "20:30");
  }
  if (/\b(5\s*pm|5pm|17[:\.]?00)\b/i.test(t) || /\bat\s+5\b/i.test(t)) {
    return matchTime(schedule, "17:00");
  }

  const generic = t.match(/\b(\d{1,2})[.:](\d{2})\b/);
  if (generic) {
    let h = parseInt(generic[1], 10);
    const mins = generic[2];
    const hasAm = /\bam\b/i.test(t);
    const hasPm = /\bpm\b/i.test(t);
    if (!hasAm && (hasPm || (h >= 1 && h <= 11))) {
      h += 12;
    }
    const startTime = `${String(h).padStart(2, "0")}:${mins}`;
    const matched = matchTime(schedule, startTime);
    if (matched) return matched;
  }

  return null;
}

function matchTime(
  schedule: ProgrammeSchedule,
  startTime: string
): { startTime: string; displayLabel: string } | null {
  const slot = schedule.slots.find((s) => s.start_time === startTime);
  if (!slot) return null;
  return { startTime: slot.start_time, displayLabel: slot.display_label };
}

export function buildProposal(
  schedule: ProgrammeSchedule,
  day: string,
  time: { startTime: string; displayLabel: string }
): TrialProposal {
  const dayLabel = DAY_LABELS[day] ?? day;
  return {
    slotId: time.startTime,
    day,
    label: `${dayLabel} ${time.displayLabel}`,
    displayLabel: time.displayLabel,
  };
}

export function slotAvailableOnDay(
  schedule: ProgrammeSchedule,
  day: string,
  startTime: string
): boolean {
  return schedule.slots.some(
    (s) => s.day_of_week === day && s.start_time === startTime
  );
}

export function parseScheduleChoice(
  text: string,
  schedule: ProgrammeSchedule
): TrialProposal | null {
  const time = parseTimeFromSchedule(text, schedule);
  const day = parseDayPreference(text);
  if (!time) return null;

  if (day) {
    if (!slotAvailableOnDay(schedule, day, time.startTime)) return null;
    return buildProposal(schedule, day, time);
  }

  const daysForTime = schedule.slots
    .filter((s) => s.start_time === time.startTime)
    .map((s) => s.day_of_week);
  if (daysForTime.length === 1) {
    return buildProposal(schedule, daysForTime[0], time);
  }

  return null;
}

export function needsDayClarification(
  text: string,
  schedule: ProgrammeSchedule,
  history?: HistoryLine[]
): boolean {
  const resolved = resolveDayAndTime(text, schedule, history);
  if (!resolved.time || resolved.day) return false;
  const daysForTime = schedule.slots.filter(
    (s) => s.start_time === resolved.time!.startTime
  );
  return daysForTime.length > 1;
}

type HistoryLine = { role: string; text: string };

export function extractDayFromText(text: string): string | null {
  return parseDayPreference(text);
}

export function extractTimeFromText(
  text: string,
  schedule: ProgrammeSchedule
): { startTime: string; displayLabel: string } | null {
  return parseTimeFromSchedule(text, schedule);
}

export function extractPartialSelectionFromHistory(
  history: HistoryLine[],
  schedule: ProgrammeSchedule
): { day: string | null; time: { startTime: string; displayLabel: string } | null } {
  let day: string | null = null;
  let time: { startTime: string; displayLabel: string } | null = null;

  const leadMsgs = [...history]
    .filter((h) => h.role === "lead")
    .slice(-4)
    .reverse();

  for (const msg of leadMsgs) {
    if (!day) day = parseDayPreference(msg.text);
    if (!time) time = parseTimeFromSchedule(msg.text, schedule);
    if (day && time) break;
  }

  return { day, time };
}

export function resolveDayAndTime(
  text: string,
  schedule: ProgrammeSchedule,
  history?: HistoryLine[]
): {
  day: string | null;
  time: { startTime: string; displayLabel: string } | null;
} {
  const fromHistory = history
    ? extractPartialSelectionFromHistory(history, schedule)
    : { day: null, time: null };

  const day = parseDayPreference(text) ?? fromHistory.day;
  const time = parseTimeFromSchedule(text, schedule) ?? fromHistory.time;

  return { day, time };
}

export function resolveScheduleChoice(
  text: string,
  schedule: ProgrammeSchedule,
  history?: HistoryLine[]
): TrialProposal | null {
  const { day, time } = resolveDayAndTime(text, schedule, history);
  if (!time) return null;

  if (day) {
    if (!slotAvailableOnDay(schedule, day, time.startTime)) return null;
    return buildProposal(schedule, day, time);
  }

  const daysForTime = schedule.slots
    .filter((s) => s.start_time === time.startTime)
    .map((s) => s.day_of_week);
  if (daysForTime.length === 1) {
    return buildProposal(schedule, daysForTime[0], time);
  }

  return null;
}

export function hasScheduleQuestion(text: string): boolean {
  const t = text.toLowerCase();
  if (!t.includes("?")) {
    return (
      /\bevery\s*day\b/.test(t) ||
      /\beveryday\b/.test(t) ||
      /\bwhich\s+days?\b/.test(t) ||
      /\bwhat\s+days?\b/.test(t) ||
      /\bwhen\s+are\b/.test(t) ||
      /\bdo\s+you\s+run\b/.test(t) ||
      (/\bavailable\b/.test(t) && /\bday/.test(t))
    );
  }
  const offTopicQ =
    /\b(recipe|cook|bake|capital of|weather|joke|homework|bitcoin)\b/i.test(t);
  if (offTopicQ) return false;
  return /\b(when|which day|schedule|class|classes|every day|available|timetable|times|hours)\b/i.test(
    t
  );
}

export function buildNeedsTimeReply(
  lead: Lead,
  schedule: ProgrammeSchedule,
  dayCode: string
): AiReply {
  const firstName = displayFirstName(lead.name);
  const dayLabel = DAY_LABELS[dayCode] ?? dayCode;
  const timesOnDay = [
    ...new Set(
      schedule.slots
        .filter((s) => s.day_of_week === dayCode)
        .map((s) => s.display_label)
    ),
  ].join(" or ");

  const text = `Great, ${firstName} — ${dayLabel} works! We've got ${timesOnDay} that day. Which time suits you for your free trial?`;

  return {
    text,
    reasoning: {
      verdict: "Approved",
      stage: "Qualifying",
      note: `Asked which time on ${dayLabel} after day-only pick.`,
    },
    assessment: "Choosing trial time",
    preview: text.slice(0, 53) + (text.length > 53 ? "..." : ""),
    status: "engaged",
    statusLabel: "Engaged",
  };
}

export function buildQuestionAnswerReply(
  lead: Lead,
  schedule: ProgrammeSchedule,
  inboundText: string
): AiReply {
  const firstName = displayFirstName(lead.name);
  const days = formatDaysPhrase(uniqueDaysFromSlots(schedule.slots));
  const times = [
    ...new Set(schedule.slots.map((s) => s.display_label)),
  ].join(", ");

  const t = inboundText.toLowerCase();
  const day = parseDayPreference(inboundText);
  const time = parseTimeFromSchedule(inboundText, schedule);

  if (day && time && slotAvailableOnDay(schedule, day, time.startTime)) {
    const proposal = buildProposal(schedule, day, time);
    const everyday = /\bevery\s*day\b|\beveryday\b/.test(t);
    const text = everyday
      ? `Good question, ${firstName}! We're not open every day — ${lead.interest} at ${lead.location} runs ${days} at ${times}. ${proposal.label} works though — shall I pencil you in for a free trial? Just reply yes when you're happy and I'll confirm it.`
      : `Yes — ${proposal.label} works at our ${lead.location} branch. Shall I pencil you in for a free trial then? Just reply yes when you're happy and I'll confirm it.`;
    return proposalReply(
      lead,
      proposal,
      text,
      "Trial time discussed — awaiting yes"
    );
  }

  let text: string;
  if (/\bevery\s*day\b|\beveryday\b/.test(t)) {
    text = `Good question, ${firstName}! We're not open every day — ${lead.interest} at ${lead.location} runs ${days} at ${times}. Which of those days and times works best for a free trial?`;
  } else {
    text = `Hey ${firstName}! ${lead.interest} at ${lead.location} is ${days} at ${times} — not every day. Happy to sort a free trial; which day and time suit you?`;
  }

  return {
    text,
    reasoning: {
      verdict: "Approved",
      stage: "Qualifying",
      note: "Answered schedule question from location settings.",
    },
    assessment: "Answering schedule questions",
    preview: text.slice(0, 53) + (text.length > 53 ? "..." : ""),
    status: "engaged",
    statusLabel: "Engaged",
  };
}

export function buildProposeReply(
  lead: Lead,
  proposal: TrialProposal
): AiReply {
  const firstName = displayFirstName(lead.name);
  const text = `Lovely, ${firstName} — shall I pencil you in for ${proposal.label} at our ${lead.location} branch for ${lead.interest}? Just reply yes when you're happy and I'll confirm it.`;

  return proposalReply(
    lead,
    proposal,
    text,
    `Trial proposed — ${proposal.label}`
  );
}

export function buildNeedsDayReply(
  lead: Lead,
  schedule: ProgrammeSchedule,
  timeLabel: string
): AiReply {
  const firstName = displayFirstName(lead.name);
  const days = formatDaysPhrase(
    uniqueDaysFromSlots(
      schedule.slots.filter((s) => s.display_label === timeLabel)
    )
  );
  const text = `Great, ${firstName} — ${timeLabel} works on ${days} at ${lead.location}. Which day suits you for your free trial?`;

  return {
    text,
    reasoning: {
      verdict: "Approved",
      stage: "Qualifying",
      note: "Asked which day for chosen time.",
    },
    assessment: "Choosing trial day",
    preview: text.slice(0, 53) + (text.length > 53 ? "..." : ""),
    status: "engaged",
    statusLabel: "Engaged",
  };
}

function proposalReply(
  lead: Lead,
  proposal: TrialProposal,
  text: string,
  assessment: string
): AiReply {
  return {
    text,
    reasoning: {
      verdict: "Approved",
      stage: "Booking",
      note: `Proposed ${proposal.label}; awaiting confirmation.`,
    },
    assessment,
    preview: text.slice(0, 53) + (text.length > 53 ? "..." : ""),
    status: "qualified",
    statusLabel: "Qualified",
    trialProposed: proposal,
  };
}

// ─── Post-LLM booking intent detection ───────────────────────────────────────

const CONFIRM_PATTERNS = [
  /\byou(?:'re| are) booked\b/i,
  /\bi'?ll\s+(?:send|get)\s+you\s+(?:a\s+)?confirmation\b/i,
  /\bconfirmed\s+(?:for|your)\b/i,
  /\bbooked\s+(?:in\s+)?for\b/i,
  // "see you" followed by a time/day reference
  /\bsee\s+you\b.{0,30}\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|then|there|next|\d)\b/i,
  /\btrial\s+is\s+confirmed\b/i,
  /\ba\s+coach\s+will\s+confirm\b/i,
  /\bwe'?ll\s+see\s+you\b/i,
];

const PROPOSE_PATTERNS = [
  /\bshall\s+i\s+pencil\s+you\s+in\b/i,
  /\bwould\s+(?:that|it)\s+(?:work|fit|suit)\b/i,
  /\bwould\s+you\s+like\s+to\s+(?:try|book|come)\b/i,
  /\bcan\s+i\s+(?:book|pencil)\s+you\s+in\b/i,
  /\bshall\s+i\s+(?:book|reserve)\b/i,
  /\bwant\s+(?:me\s+)?to\s+book\b/i,
  /\bbook\s+you\s+in\s+for\b/i,
  /\bdoes\s+(?:that|this)\s+(?:work|sound)\b/i,
];

export function detectBookingIntentInReply(
  replyText: string
): "confirm" | "propose" | null {
  if (CONFIRM_PATTERNS.some((p) => p.test(replyText))) return "confirm";
  if (PROPOSE_PATTERNS.some((p) => p.test(replyText))) return "propose";
  return null;
}

type HistoryLine = { role: string; text: string };

/**
 * After the LLM generates its reply, attempt to extract a slot from the reply
 * text + recent history. Returns the proposal or null.
 */
export function extractSlotFromReplyContext(
  replyText: string,
  schedule: ProgrammeSchedule,
  history: HistoryLine[]
): TrialProposal | null {
  // Try to resolve from the reply text itself first (most specific)
  const fromReply = resolveScheduleChoice(replyText, schedule);
  if (fromReply) return fromReply;

  // Try history + reply combined: reply might say "5pm" while history has "Tuesday"
  const combined = replyText + " " + history
    .filter((h) => h.role === "lead")
    .slice(-4)
    .map((h) => h.text)
    .join(" ");

  return resolveScheduleChoice(combined, schedule) ?? null;
}

/** Confirm when they picked a slot (with or without a prior formal proposal). */
export function buildConfirmReply(
  lead: Lead,
  proposal: TrialProposal,
  opts?: { enthusiastic?: boolean }
): AiReply {
  const firstName = displayFirstName(lead.name);
  const opener = opts?.enthusiastic
    ? `Brilliant, ${firstName}`
    : `Perfect, ${firstName}`;
  const text = `${opener}! You're booked for ${proposal.label} at our ${lead.location} branch for ${lead.interest}. A coach will confirm details shortly — see you then!`;

  return {
    text,
    reasoning: {
      verdict: "Approved",
      stage: "Booking",
      note: `Confirmed trial ${proposal.label}.`,
    },
    assessment: `Trial booked — ${proposal.label}`,
    preview: `Free trial · ${proposal.label} · ${lead.location}`,
    status: "booked",
    statusLabel: "Booked",
    trialSlot: proposal.slotId,
    trialSlotLabel: proposal.label,
    trialProposed: proposal,
  };
}
