import type { Reasoning } from "@lead-intake/shared-types";
import { oliviaSimulateForProfile } from "@lead-intake/seed-data";
import type { Lead } from "@lead-intake/shared-types";
import type { ProgrammeSchedule } from "../db/location-schedules";
import type { Env } from "../env";
import {
  displayFirstName,
  isWebsiteIntakePrompt,
  welcomeReplyFromLead,
} from "./intake-context";
import type { AiReply } from "./pipeline";

export function stubReplyForOlivia(env: Env): AiReply {
  const profile =
    env.ORGANIZATION_ID === "phiof" && env.ENABLE_DEMO_TOOLS === "true"
      ? "tuition"
      : "default";
  const fixture = oliviaSimulateForProfile(profile);
  return {
    text: fixture.aiReply,
    reasoning: fixture.reasoning,
    assessment: "New enquiry — qualifying interest",
    preview: fixture.aiReply.slice(0, 53) + "...",
    status: "engaged",
    statusLabel: "Engaged",
  };
}

export { displayFirstName } from "./intake-context";

type HistoryLine = { role: "lead" | "ai" | "staff"; text: string };

export function stubReplyFromLead(
  lead: Lead | null,
  inboundText: string,
  history: HistoryLine[] = [],
  scheduleLine?: string,
  dbSchedule?: ProgrammeSchedule | null
): AiReply {
  const firstName = displayFirstName(lead?.name ?? "");
  const location = lead?.location ?? "our academy";
  const interest = lead?.interest ?? "classes";
  const child = lead?.child;
  const lower = inboundText.toLowerCase();

  const priorAi = history.filter((h) => h.role === "ai");
  const hasLeadMessages = history.some((h) => h.role === "lead");
  const isWebsiteWelcome =
    isWebsiteIntakePrompt(inboundText) && !hasLeadMessages && priorAi.length === 0;
  const isFollowUp =
    !isWebsiteWelcome && (hasLeadMessages || priorAi.length > 0);

  if (isWebsiteWelcome && lead) {
    const { text } = welcomeReplyFromLead(lead, scheduleLine, dbSchedule);
    return {
      text,
      reasoning: {
        verdict: "Approved",
        stage: "Discovery",
        note: `Welcome from form context (${lead.interest} @ ${lead.location}).`,
      },
      assessment: "Welcome sent — free trial offered",
      preview: text.slice(0, 53) + (text.length > 53 ? "..." : ""),
      status: "engaged",
      statusLabel: "Engaged",
    };
  }

  let text: string;
  let stage = "Discovery";
  let assessment = "New enquiry — qualifying";

  if (isFollowUp) {
    stage = "Qualifying";
    assessment = "Following up — moving toward trial";
    if (
      /\b(yes|yeah|sure|ok|okay|sounds good|let's do it|book)\b/i.test(lower) &&
      lead?.trialProposed
    ) {
      stage = "Booking";
      assessment = `Trial booked — ${lead.trialProposed.label}`;
      text = `Perfect, ${firstName}! You're booked for ${lead.trialProposed.label} at our ${location} branch. A coach will confirm shortly — see you then!`;
      return {
        text,
        reasoning: {
          verdict: "Approved",
          stage: "Booking",
          note: "Confirmed proposed trial.",
        },
        assessment,
        preview: text.slice(0, 53) + (text.length > 53 ? "..." : ""),
        status: "booked",
        statusLabel: "Booked",
        trialSlot: lead.trialProposed.slotId,
        trialSlotLabel: lead.trialProposed.label,
        trialProposed: lead.trialProposed,
      };
    }
    if (dbSchedule?.slots.length && !lead?.trialSlot) {
      const priorScheduleMention = priorAi.some(
        (m) =>
          /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(
            m.text
          ) || /\b\d{1,2}[.:]?\d{0,2}\s*(am|pm)/i.test(m.text)
      );
      text = priorScheduleMention
        ? `Thanks ${firstName}! Which day and time work best for your free trial?`
        : `Thanks ${firstName}! Happy to sort a free trial for ${interest} at ${location} — which day and time suit you?`;
      return {
        text,
        reasoning: {
          verdict: "Approved",
          stage: "Qualifying",
          note: "Fallback schedule prompt.",
        },
        assessment: "Offering class times",
        preview: text.slice(0, 53) + (text.length > 53 ? "..." : ""),
        status: "engaged",
        statusLabel: "Engaged",
      };
    }
    if (
      /\b(first|beginner|never|no experience|new to)\b/i.test(lower) ||
      (/\bonly\b/i.test(lower) && /\bfirst\b/i.test(lower))
    ) {
      text = child
        ? `Perfect — beginners are very welcome! For ${child.name} at ${location} we'd love you in for a free trial. What days after school work best?`
        : `Love it — total beginners join every week at ${location} for ${interest}. Fancy a free trial? Which evenings suit you?`;
    } else if (lower.includes("price") || lower.includes("cost")) {
      text = `Fair one — most people try a free trial first so you can see if it's the right fit. Happy to chat membership after. Want to grab a trial slot this week?`;
    } else {
      text = `Got you, ${firstName} — thanks for that. Best next step is a free trial at ${location} for ${interest}. Which day and time work for you?`;
    }
  } else if (child) {
    text = `Hey ${firstName}! Yes we do ${interest} at ${location} — kids your child's age are very welcome. Want to bring them in for a free trial? What days work after school?`;
    assessment = "New parent enquiry — trial offered";
  } else {
    text = `Hey ${firstName}! Yes — ${interest} at ${location}, beginners very welcome. Happy to get you in for a free trial. Have you trained before, or would this be your first go?`;
    assessment = "New enquiry — trial offered";
  }

  const reasoning: Reasoning = {
    verdict: "Approved",
    stage,
    note: isFollowUp
      ? `Fallback reply. Thread: "${inboundText.slice(0, 50)}…"`
      : `Fallback opener for ${interest}.`,
  };

  return {
    text,
    reasoning,
    assessment,
    preview: text.slice(0, 53) + (text.length > 53 ? "..." : ""),
    status: stage === "Booking" ? "booked" : "engaged",
    statusLabel: stage === "Booking" ? "Booked" : "Engaged",
  };
}
