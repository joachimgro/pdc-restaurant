import type { Lead } from "@lead-intake/shared-types";
import { toMessages, toTimeline } from "./parse";

export const TUITION_LEAD_GROUPS = {
  today: ["amina", "david", "susan", "james"],
  yesterday: ["rachel", "tom"],
  thisWeek: ["helen"],
} as const;

const rawLeads = {
  amina: {
    name: "Amina Hassan",
    phone: "+44 7700 900 301",
    time: "4m",
    location: "Oldham",
    locationId: "default",
    status: "engaged" as const,
    statusLabel: "Engaged",
    assessment: "Handoff — awaiting staff",
    preview: "Saturday mornings would work best for us",
    unread: true,
    source: "Website",
    interest: "GCSE Maths",
    child: { name: "Yusuf", age: 15, experience: "Year 10 — struggling with algebra" },
    messages: [
      { day: "Today, 2:14 PM" },
      {
        from: "lead" as const,
        text: "Hi, my son's in Year 10 and struggling with algebra for GCSE Maths. Do you do small group sessions?",
        time: "2:14 PM",
      },
      {
        from: "ai" as const,
        text: "Hi! Yes — we keep groups to a maximum of 4 students per tutor so Yusuf would get plenty of attention. We support GCSE Maths across AQA, Edexcel, and OCR. May I ask your name and confirm Maths is the main subject?",
        time: "2:15 PM",
        reasoning: {
          verdict: "Approved",
          stage: "Discovery",
          note: "Answered from knowledge (small groups, GCSE boards). Qualifying for name and subject.",
        },
      },
      {
        from: "lead" as const,
        text: "Amina Hassan — yes GCSE Maths please. Saturday mornings would work best for us",
        time: "2:18 PM",
      },
      {
        from: "ai" as const,
        text: "Thanks Amina! I've noted Saturday mornings as your preference. Our team will call to arrange Yusuf's free skills assessment and confirm times. Is 07957 188 421 the best number to reach you on?",
        time: "2:19 PM",
        reasoning: {
          verdict: "Approved",
          stage: "Handoff",
          note: "Captured scheduling preference. No slot confirmed — staff handoff per handoff mode.",
        },
      },
    ],
    timeline: [
      { time: "2:14 PM", text: "<strong>New lead</strong> · Website — GCSE Maths" },
      { time: "2:15 PM", text: "AI engaged automatically" },
      { time: "2:19 PM", text: "<strong>Handoff</strong> · Preferred Saturday mornings" },
    ],
  },
  david: {
    name: "David Clarke",
    phone: "+44 7700 900 412",
    time: "22m",
    location: "Oldham",
    locationId: "default",
    status: "qualified" as const,
    statusLabel: "Qualified",
    assessment: "Ready for assessment call",
    preview: "She's 8 and behind in reading",
    unread: false,
    source: "Google",
    interest: "English",
    child: { name: "Ella", age: 8, experience: "KS2 — behind in reading" },
    messages: [
      { day: "Today, 1:56 PM" },
      {
        from: "lead" as const,
        text: "Looking for English tuition for my daughter — she's 8 and behind in reading. Is there a free assessment?",
        time: "1:56 PM",
      },
      {
        from: "ai" as const,
        text: "Hi David — yes, we offer a free skills assessment for new students. That helps us see where Ella is with reading and build a personalised plan. What's your name, and is English the main focus?",
        time: "1:57 PM",
        reasoning: {
          verdict: "Approved",
          stage: "Discovery",
          note: "Confirmed free assessment from knowledge. Gathering qualification fields.",
        },
      },
      {
        from: "lead" as const,
        text: "David Clarke — yes English please. She's in Year 3.",
        time: "2:01 PM",
      },
      {
        from: "ai" as const,
        text: "Thanks David! What days or times usually work for Ella? Our team will call to confirm her free skills assessment.",
        time: "2:02 PM",
        reasoning: {
          verdict: "Approved",
          stage: "Qualified",
          note: "Qualification complete. Handoff template — capture times, no booking.",
        },
      },
    ],
    timeline: [
      { time: "1:56 PM", text: "<strong>New lead</strong> · Google search" },
      { time: "1:57 PM", text: "AI engaged automatically" },
    ],
  },
  susan: {
    name: "Susan Wright",
    phone: "+44 7700 900 523",
    time: "1h",
    location: "Oldham",
    locationId: "default",
    status: "engaged" as const,
    statusLabel: "Engaged",
    assessment: "Comparing options",
    preview: "What's the difference between FCL and regular tuition?",
    unread: false,
    source: "Facebook",
    interest: "First Class Learning",
    child: { name: "Noah", age: 10, experience: "Average at school" },
    messages: [
      { day: "Today, 12:40 PM" },
      {
        from: "lead" as const,
        text: "Saw your post about First Class Learning — what's the difference between FCL and your regular tuition?",
        time: "12:40 PM",
      },
      {
        from: "ai" as const,
        text: "Hi Susan! First Class Learning (FCL) is our structured programme for ages 6–18 with daily worksheets and centre support. Our regular Maths and English sessions are also personalised with small groups (max 4 per tutor). Both start with a free skills assessment. Which subject matters most for Noah?",
        time: "12:42 PM",
        reasoning: {
          verdict: "Approved",
          stage: "Education",
          note: "Explained FCL vs regular tuition from knowledge. Open qualifying question.",
        },
      },
    ],
    timeline: [
      { time: "12:40 PM", text: "<strong>New lead</strong> · Facebook" },
      { time: "12:42 PM", text: "AI engaged automatically" },
    ],
  },
  james: {
    name: "James O'Brien",
    phone: "+44 7700 900 634",
    time: "2h",
    location: "Oldham",
    locationId: "default",
    status: "engaged" as const,
    statusLabel: "Engaged",
    assessment: "Science + after-school preference",
    preview: "Do you cover combined science for GCSE?",
    unread: false,
    source: "Referral",
    interest: "Science",
    child: { name: "Mia", age: 14, experience: "Year 9 moving to GCSE" },
    messages: [
      { day: "Today, 11:20 AM" },
      {
        from: "lead" as const,
        text: "Do you cover combined science for GCSE? Mia's in Year 9. After school would suit us.",
        time: "11:20 AM",
      },
      {
        from: "ai" as const,
        text: "Hi James — yes, we support GCSE Science including combined science across AQA, Edexcel, and OCR. I've noted after-school as your preference. May I take your name so our team can call about Mia's free skills assessment?",
        time: "11:22 AM",
        reasoning: {
          verdict: "Approved",
          stage: "Handoff",
          note: "Answered GCSE science from knowledge. Captured after-school preference for staff note.",
        },
      },
    ],
    timeline: [
      { time: "11:20 AM", text: "<strong>New lead</strong> · Referral" },
      { time: "11:22 AM", text: "AI engaged automatically" },
    ],
  },
  rachel: {
    name: "Rachel Morgan",
    phone: "+44 7700 900 745",
    time: "Yesterday",
    location: "Oldham",
    locationId: "default",
    status: "waiting" as const,
    statusLabel: "Waiting",
    assessment: "Awaiting callback",
    preview: "Thanks — we'll wait for your call",
    unread: false,
    source: "Website",
    interest: "Coding",
    child: { name: "Ethan", age: 11, experience: "Beginner" },
    messages: [
      { day: "Yesterday, 4:30 PM" },
      {
        from: "lead" as const,
        text: "Hi, does Ethan need any coding experience? He's 11 and keen to try.",
        time: "4:30 PM",
      },
      {
        from: "ai" as const,
        text: "Hi Rachel! No prior experience needed — our Coding sessions welcome beginners. We keep groups small (max 4 per tutor). What's Ethan's name and would weekday evenings work for a free skills assessment?",
        time: "4:31 PM",
      },
      {
        from: "lead" as const,
        text: "Ethan Morgan — weekday evenings after 5pm would be ideal. Thanks — we'll wait for your call",
        time: "4:38 PM",
      },
      {
        from: "ai" as const,
        text: "Perfect — I've passed that to the team. They'll call to confirm Ethan's free skills assessment. Speak soon!",
        time: "4:39 PM",
        reasoning: {
          verdict: "Approved",
          stage: "Handoff",
          note: "Preference captured. Lead awaiting staff callback.",
        },
      },
    ],
    timeline: [
      { time: "Yesterday", text: "<strong>New lead</strong> · Website — Coding" },
      { time: "Yesterday", text: "<strong>Handoff</strong> · Weekday evenings after 5pm" },
    ],
  },
  tom: {
    name: "Tom Fletcher",
    phone: "+44 7700 900 856",
    time: "Yesterday",
    location: "Oldham",
    locationId: "default",
    status: "new" as const,
    statusLabel: "New",
    assessment: "Just arrived",
    preview: "Are you Ofsted registered?",
    unread: true,
    source: "Website",
    interest: "Maths",
    messages: [
      { day: "Yesterday, 6:10 PM" },
      {
        from: "lead" as const,
        text: "Are you Ofsted registered? Looking at maths help for my twins.",
        time: "6:10 PM",
      },
    ],
    timeline: [
      { time: "Yesterday", text: "<strong>New lead</strong> · Website" },
    ],
  },
  helen: {
    name: "Helen Price",
    phone: "+44 7700 900 967",
    time: "Mon",
    location: "Oldham",
    locationId: "default",
    status: "cold" as const,
    statusLabel: "Cold",
    assessment: "No response after follow-up",
    preview: "Auto follow-up · 2d later",
    unread: false,
    source: "Website",
    interest: "English",
    child: { name: "Sophie", age: 6, experience: "Reception" },
    messages: [
      { day: "Monday, 3:00 PM" },
      {
        from: "lead" as const,
        text: "Hi, interested in English for my daughter starting reception next term.",
        time: "3:00 PM",
      },
      {
        from: "ai" as const,
        text: "Hi Helen! We'd love to help Sophie get a strong start. We offer a free skills assessment — may I take your name and when would suit you for a call from our team?",
        time: "3:01 PM",
      },
      { autoFollowup: true as const, label: "Auto follow-up · 2d later" },
      {
        from: "ai" as const,
        text: "Hi Helen — just checking in. If you'd still like to arrange Sophie's free skills assessment, reply anytime and we'll have the team call you.",
        time: "Wed 3:05 PM",
        reasoning: {
          verdict: "Approved",
          stage: "Re-engagement",
          note: "Soft follow-up. No further messages unless lead replies.",
        },
      },
    ],
    timeline: [
      { time: "Mon", text: "<strong>New lead</strong> · Website" },
      { time: "Wed", text: "Auto follow-up sent" },
    ],
  },
};

export function buildTuitionDemoLeads(): Record<string, Lead> {
  const out: Record<string, Lead> = {};
  for (const [id, raw] of Object.entries(rawLeads)) {
    out[id] = {
      id,
      name: raw.name,
      phone: raw.phone,
      time: raw.time,
      location: raw.location,
      locationId: raw.locationId,
      status: raw.status,
      statusLabel: raw.statusLabel,
      assessment: raw.assessment,
      preview: raw.preview,
      unread: raw.unread,
      source: raw.source,
      interest: raw.interest,
      child: "child" in raw ? raw.child : undefined,
      notes: [],
      messages: toMessages(raw.messages),
      timeline: toTimeline(raw.timeline),
    };
  }
  return out;
}

export const TUITION_OLIVIA_SIMULATE = {
  name: "Olivia Bennett",
  phone: "+44 7700 900 615",
  location: "Oldham",
  locationId: "default",
  source: "Referral",
  interest: "GCSE Maths",
  inboundText:
    "Hi, a friend recommended you — my daughter's in Year 10 and needs help with maths",
  aiReply:
    "Hi Olivia! Lovely to hear from you. We support GCSE Maths in small groups (max 4 per tutor) with a free skills assessment to start. What's your daughter's name, and which days or times usually work for you?",
  reasoning: {
    verdict: "Approved",
    stage: "Discovery",
    note: "Acknowledged referral. Qualifying for child context and handoff times — no slot booking.",
  },
};
