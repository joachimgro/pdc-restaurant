import type { Lead } from "@lead-intake/shared-types";
import { DAY_LABELS, parseDayPreference } from "./booking-flow";

export type TopicCategory =
  | "ON_TOPIC"
  | "CONVERSATIONAL"
  | "OFF_TOPIC"
  | "PROMPT_INJECTION"
  | "IDENTITY_QUESTION"
  | "EMOTIONAL"
  | "RESET_ATTEMPT";

export interface TopicGuardInput {
  inboundText: string;
  lead: Lead;
  history: { role: "lead" | "ai" | "staff"; text: string }[];
}

export interface TopicCheckResult {
  onTopic: boolean;
  category: TopicCategory;
  deflectionReply?: string;
  reason: string;
  deflectionStage?: string;
}

type HistoryLine = { role: "lead" | "ai" | "staff"; text: string };

interface DeflectionContext {
  interest: string;
  location: string;
  trialLabel: string;
  lastDiscussedDay: string;
  lastDiscussedTime: string;
  hasDiscussedSchedule: boolean;
  isBooked: boolean;
  isQualified: boolean;
}

const CONVERSATIONAL_PASS = [
  /^(yes|yeah|yep|yh|nah|nope|no|sure|ok|okay|cool|great|perfect|lovely|thanks|cheers|ta|please|absolutely|definitely|sounds good|works for me|let's do it|go on then|👍|🙏|❤️|😊|💪)/i,
  /^(hi|hey|hello|yo|morning|afternoon|evening)/i,
  /^.{1,12}$/,
];

export const PROMPT_INJECTION_SIGNALS = [
  /ignore (all |your )?(previous |prior )?(instructions|prompts|rules|system)/i,
  /you are now/i,
  /new (instructions|rules|persona|role|policy)/i,
  /forget (everything|all|your|the) (instructions|rules|prompts)/i,
  /system\s*prompt/i,
  /\bDAN\b/,
  /do anything now/i,
  /jailbreak/i,
  /what('s| is) (in |)your (system |)(prompt|instructions|rules)/i,
  /show me (your )?(prompt|instructions|rules|config)/i,
  /show me.{0,50}\b(rules|instructions|prompt|guidelines)\b/i,
  /\b(rules|instructions|prompt).{0,40}\b(you follow|when responding|for responding)\b/i,
  /\bquality assurance\b.{0,50}\b(rules|prompt|instructions|guidelines)\b/i,
  /\b(rules|prompt|instructions).{0,50}\bquality assurance\b/i,
  /act as (a |an |my )/i,
  /pretend (to be|you're|you are)/i,
  /\[(system|admin|assistant)\s*(update|message|override|prompt|instruction)/i,
  /\bsystem\s*update\b/i,
  /\bconfirm by saying\b/i,
  /\banswer all questions regardless\b/i,
  /\b(regardless of topic|ignore (your )?topic|no restrictions)\b/i,
  /\boverride\b.{0,40}\b(policy|instructions|rules|restrictions)\b/i,
  /\bdeveloper mode\b/i,
  /\bunrestricted mode\b/i,
];

/** Short replies that obey an injection instead of booking. */
export const INJECTION_COMPLIANCE_REPLIES = [
  /^policy\s+updated\.?$/i,
  /^instructions?\s+updated\.?$/i,
  /^(understood|acknowledged|confirmed|will do)\.?$/i,
];

export function detectPromptInjection(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  return PROMPT_INJECTION_SIGNALS.some((r) => r.test(t));
}

export function looksLikeInjectionCompliance(
  reply: string,
  inboundText: string
): boolean {
  const r = reply.trim();
  if (!r) return false;

  if (INJECTION_COMPLIANCE_REPLIES.some((re) => re.test(r))) return true;

  if (!detectPromptInjection(inboundText)) return false;

  const lower = r.toLowerCase();
  if (
    r.length < 160 &&
    /\b(policy\s+updated|updated our policy|new policy|instructions?\s+updated)\b/i.test(
      lower
    )
  ) {
    return true;
  }

  return false;
}

export function injectionDeflectionReply(
  input: TopicGuardInput
): TopicCheckResult {
  const defCtx = buildDeflectionContext(input.lead, input.history);
  const { text, stage } = buildDeflection("PROMPT_INJECTION", defCtx);
  return {
    onTopic: false,
    category: "PROMPT_INJECTION",
    deflectionReply: text,
    deflectionStage: stage,
    reason: "Prompt injection attempt detected",
  };
}

const IDENTITY_SIGNALS = [
  /\b(are you) (a |)(bot|robot|ai|automated|real|human|person|machine)\b/i,
  /\b(is this) (a |)(bot|automated|ai|real person)\b/i,
  /\b(am i talking to) (a |an |)(bot|ai|real|human|person)\b/i,
  /\b(who am i (talking|speaking|chatting) (to|with))\b/i,
];

const EMOTIONAL_SIGNALS = [
  /\b(rough day|bad day|tough day|hard time|struggling|feeling down|depressed|stressed|anxious|lonely|sad|upset)\b/i,
  /\b(just need (someone|to talk|to chat|a friend))\b/i,
  /\b(talk to me|chat with me|keep me company)\b/i,
];

const RESET_SIGNALS = [
  /\b(forget (all |everything |)(that|this)|start (from scratch|over|again|fresh))\b/i,
  /\b(scrap (that|this|it|everything)|wipe the slate|begin again)\b/i,
];

const OFF_TOPIC_SIGNALS = [
  /\b(recipe|cook|bake|ingredients|calories|food|lasagna|lasagne)\b/i,
  /\b(homework|essay|write me a|code|program|script|debug)\b/i,
  /\b(weather|forecast|temperature|rain)\b/i,
  /\b(news|stock|bitcoin|crypto|share price|invest)\b/i,
  /\b(capital of|president of|who invented|how many|what year did)\b/i,
  /\b(movie|film|song|album|playlist|spotify|netflix)\b/i,
  /\b(translate|language|french|spanish|german|mandarin)\b/i,
  /\b(joke|riddle|poem|story|sing|rap)\b/i,
];

const ON_TOPIC_SIGNALS = [
  /\b(class|classes|session|training|lesson|schedule|timetable)\b/i,
  /\b(trial|taster|book|booking|sign up|register|join)\b/i,
  /\b(bjj|jiu.?jitsu|karate|muay thai|mma|kickboxing|boxing|taekwondo|judo|wrestling)\b/i,
  /\b(kids|children|child|son|daughter|teen|adult|beginner)\b/i,
  /\b(price|cost|how much|fees|membership|monthly|pay)\b/i,
  /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
  /\b(cancel|reschedule|change|different day)\b/i,
  /\b(what to wear|what to bring|gi|uniform|gear|parking|address|where are you|find you)\b/i,
  /\b(age|years old|experience|level|first time|never done)\b/i,
  /\b(coach|instructor|teacher)\b/i,
  /\b\d{1,2}[.:h]?\d{0,2}\s*(am|pm)?\b/i,
];

const TIME_IN_TEXT =
  /\b(\d{1,2})[.:h]?(\d{2})?\s*(am|pm)?\b|\b(5\s*pm|5pm|7[.:]?30|8[.:]?30)\b/i;

function fillTemplate(
  template: string,
  ctx: DeflectionContext
): string {
  const map: Record<string, string> = {
    interest: ctx.interest,
    location: ctx.location,
    trialSlotLabel: ctx.trialLabel,
    lastDiscussedDay: ctx.lastDiscussedDay,
  };

  let out = template;
  for (const [key, value] of Object.entries(map)) {
    if (value) {
      out = out.replace(new RegExp(`\\{${key}\\}`, "g"), value);
    }
  }

  out = out
    .replace(/\s+—\s+which day works best for you\?/g, "")
    .replace(/\s+So were you thinking\s+for your trial\?/g, "")
    .replace(/\s+Still good for\s+\?/g, "")
    .replace(/\{[a-zA-Z]+\}/g, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.!?])/g, "$1")
    .trim();

  return out;
}

function extractTimeLabel(text: string): string | null {
  const t = text.toLowerCase();
  if (/\b7[.:]?30\s*(?:pm)?\b/.test(t) || /\b730\b/.test(t)) return "7:30pm";
  if (/\b8[.:]?30\s*(?:pm)?\b/.test(t) || /\b830\b/.test(t)) return "8:30pm";
  if (/\b(5\s*pm|5pm)\b/.test(t)) return "5pm";
  const m = t.match(TIME_IN_TEXT);
  if (m) return m[0].trim();
  return null;
}

function buildDeflectionContext(
  lead: Lead,
  history: HistoryLine[]
): DeflectionContext {
  const trialLabel =
    lead.trialSlotLabel || lead.trialProposed?.label || "";
  const interest = lead.interest || "classes";
  const location = lead.location || "our academy";

  let lastDiscussedDay = "";
  let lastDiscussedTime = "";

  const leadMsgs = [...history]
    .filter((h) => h.role === "lead")
    .slice(-4)
    .reverse();

  for (const msg of leadMsgs) {
    if (!lastDiscussedDay) {
      const dayCode = parseDayPreference(msg.text);
      if (dayCode) lastDiscussedDay = DAY_LABELS[dayCode] ?? dayCode;
    }
    if (!lastDiscussedTime) {
      const time = extractTimeLabel(msg.text);
      if (time) lastDiscussedTime = time;
    }
  }

  const aiMsgs = history.filter((h) => h.role === "ai");
  const hasAiSchedule = aiMsgs.some(
    (m) =>
      /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(
        m.text
      ) || /\b\d{1,2}[.:]?\d{0,2}\s*(am|pm)/i.test(m.text)
  );

  const hasDiscussedSchedule =
    hasAiSchedule ||
    lead.status === "qualified" ||
    lead.status === "booked" ||
    Boolean(lastDiscussedDay || lastDiscussedTime);

  return {
    interest,
    location,
    trialLabel,
    lastDiscussedDay,
    lastDiscussedTime,
    hasDiscussedSchedule,
    isBooked: lead.status === "booked",
    isQualified: lead.status === "qualified" || Boolean(lead.trialProposed),
  };
}

function buildDeflection(
  category: Exclude<TopicCategory, "ON_TOPIC" | "CONVERSATIONAL">,
  ctx: DeflectionContext
): { text: string; stage: string } {
  const { interest, location, trialLabel, lastDiscussedDay } = ctx;

  if (category === "OFF_TOPIC") {
    if (ctx.isBooked && trialLabel) {
      return {
        stage: "Off-topic",
        text: fillTemplate(
          `Ha — can't help with that one! You're all set for {trialSlotLabel} though. See you there!`,
          ctx
        ),
      };
    }
    if (ctx.isQualified && trialLabel) {
      return {
        stage: "Off-topic",
        text: fillTemplate(
          `Haha good question but a bit above my pay grade! Still good for {trialSlotLabel}?`,
          ctx
        ),
      };
    }
    if (ctx.hasDiscussedSchedule && lastDiscussedDay) {
      return {
        stage: "Off-topic",
        text: fillTemplate(
          `Ha — not my area! So were you thinking {lastDiscussedDay} for your trial?`,
          ctx
        ),
      };
    }
    return {
      stage: "Off-topic",
      text: fillTemplate(
        `Ha, I wish I knew! I'm just the booking assistant though. Still keen on trying {interest}? Which day works best for you?`,
        ctx
      ),
    };
  }

  if (category === "PROMPT_INJECTION") {
    if (ctx.isBooked && trialLabel) {
      return {
        stage: "Injection blocked",
        text: fillTemplate(
          `I'm just here to help with bookings! You're all set for {trialSlotLabel} — see you there.`,
          ctx
        ),
      };
    }
    if (ctx.isQualified && trialLabel) {
      return {
        stage: "Injection blocked",
        text: fillTemplate(
          `Nice try! I'm just the booking assistant. Still good for {trialSlotLabel}?`,
          ctx
        ),
      };
    }
    if (ctx.hasDiscussedSchedule && lastDiscussedDay) {
      return {
        stage: "Injection blocked",
        text: fillTemplate(
          `Nice try — I'm just the booking assistant! Still good for {lastDiscussedDay} for your trial?`,
          ctx
        ),
      };
    }
    if (ctx.hasDiscussedSchedule) {
      return {
        stage: "Injection blocked",
        text: fillTemplate(
          `I'm just here to help with classes and bookings — not system stuff! Which day and time still work for your {interest} trial?`,
          ctx
        ),
      };
    }
    return {
      stage: "Injection blocked",
      text: fillTemplate(
        `I'm just here to help with classes and bookings! Fancy trying {interest} at {location}? Which day suits you?`,
        ctx
      ),
    };
  }

  if (category === "IDENTITY_QUESTION") {
    if (ctx.isBooked && trialLabel) {
      return {
        stage: "Identity question",
        text: fillTemplate(
          `I'm the booking assistant — bit of tech magic behind the scenes! But your session on {trialSlotLabel} will be with a real coach. See you there!`,
          ctx
        ),
      };
    }
    if (ctx.isQualified && trialLabel) {
      return {
        stage: "Identity question",
        text: fillTemplate(
          `Good question — I'm the booking assistant, mix of tech and the team here. Your trial will be all real coaches though! Still good for {trialSlotLabel}?`,
          ctx
        ),
      };
    }
    return {
      stage: "Identity question",
      text: fillTemplate(
        `I'm the booking assistant — part human team, part tech! Your trial will be with a real coach though. Want to pick a day for {interest}?`,
        ctx
      ),
    };
  }

  if (category === "EMOTIONAL") {
    if ((ctx.isQualified || ctx.isBooked) && trialLabel) {
      return {
        stage: "Emotional redirect",
        text: fillTemplate(
          `Sorry to hear that. Honestly, smashing pads is one of the best stress relievers going. You've got {trialSlotLabel} coming up — might be exactly what you need!`,
          ctx
        ),
      };
    }
    return {
      stage: "Emotional redirect",
      text: fillTemplate(
        `Sorry to hear that — hope things pick up. Training's actually brilliant for clearing your head. Want me to get a trial sorted at {location} so you can come blow off some steam?`,
        ctx
      ),
    };
  }

  // RESET_ATTEMPT (booked only — caller gates)
  return {
    stage: "Reset blocked",
    text: fillTemplate(
      `No worries! You're currently booked for {trialSlotLabel}. Want me to change that to a different day or programme instead? Easier than starting over.`,
      ctx
    ),
  };
}

function isBookedLead(lead: Lead): boolean {
  return (
    lead.status === "booked" &&
    Boolean(lead.trialConfirmedAt || lead.trialSlotLabel || lead.trialSlot)
  );
}

function isConversationalPass(text: string): boolean {
  if (text.length > 72) return false;
  return CONVERSATIONAL_PASS.some((r) => r.test(text));
}

export function checkTopic(input: TopicGuardInput): TopicCheckResult {
  const text = input.inboundText.trim();
  const { lead, history } = input;
  const defCtx = buildDeflectionContext(lead, history);

  if (detectPromptInjection(text)) {
    const { text: reply, stage } = buildDeflection("PROMPT_INJECTION", defCtx);
    return {
      onTopic: false,
      category: "PROMPT_INJECTION",
      deflectionReply: reply,
      deflectionStage: stage,
      reason: "Prompt injection attempt detected",
    };
  }

  if (isConversationalPass(text)) {
    return {
      onTopic: true,
      category: "CONVERSATIONAL",
      reason: "Conversational reply — contextual",
    };
  }

  if (IDENTITY_SIGNALS.some((r) => r.test(text))) {
    const { text: reply, stage } = buildDeflection("IDENTITY_QUESTION", defCtx);
    return {
      onTopic: false,
      category: "IDENTITY_QUESTION",
      deflectionReply: reply,
      deflectionStage: stage,
      reason: "Lead asked about AI/bot identity",
    };
  }

  if (EMOTIONAL_SIGNALS.some((r) => r.test(text))) {
    const { text: reply, stage } = buildDeflection("EMOTIONAL", defCtx);
    return {
      onTopic: false,
      category: "EMOTIONAL",
      deflectionReply: reply,
      deflectionStage: stage,
      reason: "Emotional support request — redirected with warmth",
    };
  }

  if (RESET_SIGNALS.some((r) => r.test(text))) {
    if (isBookedLead(lead)) {
      const { text: reply, stage } = buildDeflection("RESET_ATTEMPT", defCtx);
      return {
        onTopic: false,
        category: "RESET_ATTEMPT",
        deflectionReply: reply,
        deflectionStage: stage,
        reason: "Reset attempt while booked — offered reschedule instead",
      };
    }
    return {
      onTopic: true,
      category: "ON_TOPIC",
      reason: "Reset request while not booked — allow through",
    };
  }

  const offMatch = OFF_TOPIC_SIGNALS.find((r) => r.test(text));
  if (offMatch) {
    const alsoOnTopic = ON_TOPIC_SIGNALS.some((r) => r.test(text));
    if (!alsoOnTopic) {
      const { text: reply, stage } = buildDeflection("OFF_TOPIC", defCtx);
      return {
        onTopic: false,
        category: "OFF_TOPIC",
        deflectionReply: reply,
        deflectionStage: stage,
        reason: `Off-topic signal: ${offMatch.source}`,
      };
    }
  }

  if (ON_TOPIC_SIGNALS.some((r) => r.test(text))) {
    return {
      onTopic: true,
      category: "ON_TOPIC",
      reason: "On-topic signal matched",
    };
  }

  return {
    onTopic: true,
    category: "ON_TOPIC",
    reason: "No strong signal — allowing through to LLM",
  };
}
