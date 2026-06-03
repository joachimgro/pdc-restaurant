import { z } from "zod";
import { LeadSchema, MessageSchema } from "./lead";

export const DomainEventTypeSchema = z.enum([
  "lead.created",
  "lead.updated",
  "message.created",
  "typing.started",
  "typing.stopped",
]);
export type DomainEventType = z.infer<typeof DomainEventTypeSchema>;

const baseEvent = z.object({
  id: z.string(),
  createdAt: z.string(),
});

export const LeadCreatedEventSchema = baseEvent.extend({
  type: z.literal("lead.created"),
  payload: z.object({ lead: LeadSchema }),
});

export const LeadUpdatedEventSchema = baseEvent.extend({
  type: z.literal("lead.updated"),
  payload: z.object({ leadId: z.string(), patch: z.record(z.unknown()) }),
});

export const MessageCreatedEventSchema = baseEvent.extend({
  type: z.literal("message.created"),
  payload: z.object({
    leadId: z.string(),
    message: MessageSchema,
  }),
});

export const TypingStartedEventSchema = baseEvent.extend({
  type: z.literal("typing.started"),
  payload: z.object({ leadId: z.string() }),
});

export const TypingStoppedEventSchema = baseEvent.extend({
  type: z.literal("typing.stopped"),
  payload: z.object({ leadId: z.string() }),
});

export const DomainEventSchema = z.discriminatedUnion("type", [
  LeadCreatedEventSchema,
  LeadUpdatedEventSchema,
  MessageCreatedEventSchema,
  TypingStartedEventSchema,
  TypingStoppedEventSchema,
]);
export type DomainEvent = z.infer<typeof DomainEventSchema>;

export const SseEnvelopeSchema = z.object({
  event: DomainEventSchema,
});
export type SseEnvelope = z.infer<typeof SseEnvelopeSchema>;
