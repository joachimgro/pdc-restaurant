import { z } from "zod";
import { LeadSchema, MessageSchema } from "./lead";

export const DomainEventTypeSchema = z.enum([
  "lead.created",
  "lead.updated",
  "lead.ai_failed",
  "lead.ai_aborted",
  "lead.sync_failure",
  "lead.ai_rate_limited",
  "message.created",
  "typing.started",
  "typing.stopped",
  "reservation.created",
  "reservation.updated",
  "reservation.status_changed",
  "reservation.assigned",
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

export const LeadAiFailedEventSchema = baseEvent.extend({
  type: z.literal("lead.ai_failed"),
  payload: z.object({
    leadId: z.string(),
    error: z.string(),
    attempts: z.number(),
    queueMessageId: z.string().optional(),
  }),
});

export const LeadAiAbortedEventSchema = baseEvent.extend({
  type: z.literal("lead.ai_aborted"),
  payload: z.object({
    leadId: z.string(),
    reason: z.string(),
  }),
});

export const LeadSyncFailureEventSchema = baseEvent.extend({
  type: z.literal("lead.sync_failure"),
  payload: z.object({
    leadId: z.string(),
    error: z.string(),
    phase: z.string(),
  }),
});

export const LeadAiRateLimitedEventSchema = baseEvent.extend({
  type: z.literal("lead.ai_rate_limited"),
  payload: z.object({
    leadId: z.string(),
    count: z.number(),
    reason: z.string().optional(),
  }),
});

/**
 * Reservation events (spec §12). Every service write path emits one — a
 * missing emit means a stale floor plan during service, which the audit calls
 * out as worse than no floor plan at all.
 *
 * Payloads carry ids and the changed fields rather than the whole reservation:
 * the console refetches detail on selection, and a full row here would leak
 * guest contact details into an SSE stream every staff member is subscribed to.
 */
export const ReservationCreatedEventSchema = baseEvent.extend({
  type: z.literal("reservation.created"),
  payload: z.object({
    reservationId: z.string(),
    locationId: z.string(),
    serviceDate: z.string(),
    startTime: z.string(),
    partySize: z.number(),
    tableIds: z.array(z.string()),
  }),
});

export const ReservationUpdatedEventSchema = baseEvent.extend({
  type: z.literal("reservation.updated"),
  payload: z.object({
    reservationId: z.string(),
    serviceDate: z.string(),
    patch: z.record(z.unknown()),
  }),
});

export const ReservationStatusChangedEventSchema = baseEvent.extend({
  type: z.literal("reservation.status_changed"),
  payload: z.object({
    reservationId: z.string(),
    serviceDate: z.string(),
    from: z.string(),
    to: z.string(),
  }),
});

export const ReservationAssignedEventSchema = baseEvent.extend({
  type: z.literal("reservation.assigned"),
  payload: z.object({
    reservationId: z.string(),
    serviceDate: z.string(),
    tableIds: z.array(z.string()),
    assignmentLocked: z.boolean(),
  }),
});

export const DomainEventSchema = z.discriminatedUnion("type", [
  LeadCreatedEventSchema,
  LeadUpdatedEventSchema,
  LeadAiFailedEventSchema,
  LeadAiAbortedEventSchema,
  LeadSyncFailureEventSchema,
  LeadAiRateLimitedEventSchema,
  MessageCreatedEventSchema,
  TypingStartedEventSchema,
  TypingStoppedEventSchema,
  ReservationCreatedEventSchema,
  ReservationUpdatedEventSchema,
  ReservationStatusChangedEventSchema,
  ReservationAssignedEventSchema,
]);
export type DomainEvent = z.infer<typeof DomainEventSchema>;

export const SseEnvelopeSchema = z.object({
  event: DomainEventSchema,
});
export type SseEnvelope = z.infer<typeof SseEnvelopeSchema>;
