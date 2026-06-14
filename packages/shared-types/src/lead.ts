import { z } from "zod";

export const LeadStatusSchema = z.enum([
  "new",
  "engaged",
  "qualified",
  "booked",
  "waiting",
  "cold",
]);
export type LeadStatus = z.infer<typeof LeadStatusSchema>;

export const MessageFromSchema = z.enum(["lead", "ai", "staff", "system"]);
export type MessageFrom = z.infer<typeof MessageFromSchema>;

export const ReasoningSchema = z.object({
  verdict: z.string(),
  stage: z.string(),
  note: z.string(),
});
export type Reasoning = z.infer<typeof ReasoningSchema>;

export const ChildSchema = z.object({
  name: z.string(),
  age: z.union([z.number(), z.string()]),
  experience: z.string(),
});
export type Child = z.infer<typeof ChildSchema>;

export const TrialProposalSchema = z.object({
  slotId: z.string(),
  day: z.string(),
  label: z.string(),
  displayLabel: z.string(),
});
export type TrialProposal = z.infer<typeof TrialProposalSchema>;

export const TimelinePartSchema = z.object({
  bold: z.string().optional(),
  text: z.string(),
});
export type TimelinePart = z.infer<typeof TimelinePartSchema>;

export const TimelineEventSchema = z.object({
  time: z.string(),
  parts: z.array(TimelinePartSchema),
});
export type TimelineEvent = z.infer<typeof TimelineEventSchema>;

export const LeadNoteSchema = z.object({
  id: z.string(),
  body: z.string(),
  authorName: z.string(),
  createdAt: z.string(),
  authorUserId: z.string().optional(),
});
export type LeadNote = z.infer<typeof LeadNoteSchema>;

export const DayLabelMessageSchema = z.object({
  kind: z.literal("day"),
  day: z.string(),
});

export const AutoFollowupMessageSchema = z.object({
  kind: z.literal("auto_followup"),
  label: z.string(),
});

export const ChatMessageSchema = z.object({
  kind: z.literal("chat"),
  id: z.string().optional(),
  from: MessageFromSchema,
  text: z.string(),
  time: z.string(),
  reasoning: ReasoningSchema.optional(),
  staffAuthorName: z.string().optional(),
  staffUserId: z.string().optional(),
});

export const MessageSchema = z.discriminatedUnion("kind", [
  DayLabelMessageSchema,
  AutoFollowupMessageSchema,
  ChatMessageSchema,
]);
export type Message = z.infer<typeof MessageSchema>;

export const LeadSchema = z.object({
  id: z.string(),
  name: z.string(),
  phone: z.string(),
  time: z.string(),
  location: z.string(),
  locationId: z.string().optional(),
  status: LeadStatusSchema,
  statusLabel: z.string(),
  assessment: z.string(),
  preview: z.string(),
  unread: z.boolean(),
  source: z.string(),
  interest: z.string(),
  child: ChildSchema.optional(),
  trialSlot: z.string().optional(),
  trialSlotLabel: z.string().optional(),
  trialProposed: TrialProposalSchema.optional(),
  trialConfirmedAt: z.string().optional(),
  locationConfirmed: z.boolean().optional(),
  justArrived: z.boolean().optional(),
  aiPaused: z.boolean().optional(),
  notes: z.array(LeadNoteSchema).default([]),
  messages: z.array(MessageSchema),
  timeline: z.array(TimelineEventSchema),
});
export type Lead = z.infer<typeof LeadSchema>;

export const LeadSummarySchema = LeadSchema.pick({
  id: true,
  name: true,
  phone: true,
  time: true,
  location: true,
  status: true,
  statusLabel: true,
  assessment: true,
  preview: true,
  unread: true,
  source: true,
  interest: true,
  justArrived: true,
});
export type LeadSummary = z.infer<typeof LeadSummarySchema>;

export const GroupedLeadsSchema = z.object({
  activeCount: z.number(),
  groups: z.object({
    today: z.array(z.string()),
    yesterday: z.array(z.string()),
    thisWeek: z.array(z.string()),
  }),
  leads: z.record(z.string(), LeadSchema),
});
export type GroupedLeads = z.infer<typeof GroupedLeadsSchema>;

export const ListLeadsResponseSchema = z.object({
  activeCount: z.number(),
  groups: z.object({
    today: z.array(z.string()),
    yesterday: z.array(z.string()),
    thisWeek: z.array(z.string()),
  }),
  leads: z.record(z.string(), LeadSummarySchema),
});
export type ListLeadsResponse = z.infer<typeof ListLeadsResponseSchema>;
