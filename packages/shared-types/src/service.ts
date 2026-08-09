import { z } from "zod";

/**
 * Service module API contract (reservations / floor plan / waitlist).
 *
 * Round-trip rule: every GET response body is a valid PUT/POST request body
 * for the same resource. Optional values are `.nullable()` and always present
 * in responses — never `.optional()` — so a GET → PUT → GET cycle is byte
 * identical rather than silently dropping undefined keys.
 */

// ── Shared constants (spec Appendix B) ───────────────────────────────────────

export const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type DayCode = (typeof DAYS)[number];

export const TABLE_SHAPES = [
  "round",
  "square",
  "rect",
  "booth",
  "banquette",
  "bar_stool",
  "high_top",
  "sofa",
] as const;
export type TableShape = (typeof TABLE_SHAPES)[number];

export const RESERVATION_STATUSES = [
  "pending_payment",
  "confirmed",
  "seated",
  "finished",
  "cancelled",
  "no_show",
  "expired",
] as const;
export type ReservationStatus = (typeof RESERVATION_STATUSES)[number];

/**
 * Statuses that hold a table against other bookings.
 *
 * The single source for every availability query and every conflict check.
 * Never inline this list: a query that omits `seated` double-books occupied
 * tables, and the omission is invisible in review.
 */
export const OCCUPYING_STATUSES = [
  "pending_payment",
  "confirmed",
  "seated",
] as const satisfies readonly ReservationStatus[];
export type OccupyingStatus = (typeof OCCUPYING_STATUSES)[number];

export const RESERVATION_SOURCES = [
  "online",
  "phone",
  "walk_in",
  "staff",
  "waitlist",
  "import",
] as const;
export type ReservationSource = (typeof RESERVATION_SOURCES)[number];

export const EXCEPTION_KINDS = [
  "closed",
  "special_hours",
  "block_room",
  "block_table",
  "no_online",
  "private_hire",
] as const;
export type ExceptionKind = (typeof EXCEPTION_KINDS)[number];

/** Venue-scoped turn time defaults, seeded for a new venue. */
export const DEFAULT_TURN_RULES = [
  { partyMin: 1, partyMax: 2, turnMinutes: 90 },
  { partyMin: 3, partyMax: 4, turnMinutes: 105 },
  { partyMin: 5, partyMax: 6, turnMinutes: 120 },
  { partyMin: 7, partyMax: 10, turnMinutes: 150 },
  { partyMin: 11, partyMax: 99, turnMinutes: 180 },
] as const;

/** Floor plan canvas grid is snapped to this many units. */
export const FLOOR_GRID_UNITS = 10;

// ── Primitives ───────────────────────────────────────────────────────────────

/**
 * Venue-local clock time. Hours may exceed 23 so a late bar closing at 01:30
 * is stored as "25:30" against its opening day (spec Appendix C).
 */
export const TimeStringSchema = z
  .string()
  .regex(/^\d{2}:\d{2}$/, "Expected HH:MM");

export const DateStringSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");

export const DayCodeSchema = z.enum(DAYS);
export const TableShapeSchema = z.enum(TABLE_SHAPES);
export const ExceptionKindSchema = z.enum(EXCEPTION_KINDS);

// ── Venue settings ───────────────────────────────────────────────────────────

export const VenueSettingsSchema = z.object({
  locationId: z.string().min(1),
  timezone: z.string().min(1),
  bookingSlug: z.string().min(1).nullable(),
  slotIntervalMin: z.number().int().min(5).max(120),
  defaultTurnMinutes: z.number().int().min(15).max(600),
  graceAfterCloseMin: z.number().int().min(0).max(240),
  minPartyOnline: z.number().int().min(1).max(100),
  maxPartyOnline: z.number().int().min(1).max(100),
  largePartyMessage: z.string().nullable(),
  minLeadMinutes: z.number().int().min(0).max(20160),
  maxAdvanceDays: z.number().int().min(1).max(730),
  holdTtlSeconds: z.number().int().min(60).max(3600),
  autoAssignTables: z.boolean(),
  allowOnlineWaitlist: z.boolean(),
  cancellationWindowHours: z.number().int().min(0).max(720),
  brand: z.record(z.unknown()).nullable(),
  contactPhone: z.string().nullable(),
  contactEmail: z.string().nullable(),
  addressText: z.string().nullable(),
  /** Online cap when table combinations can seat larger parties. */
  maxPartyCombined: z.number().int().min(1).max(100),
  reviewUrl: z.string().nullable(),
  reviewRequestDelayHours: z.number().int().min(0).max(168),
  /** Minutes past start time before an unattended booking flips to no_show. */
  noShowGraceMin: z.number().int().min(0).max(180),
  /** Reminder notifications due inside this venue-local window defer to the end. */
  quietHoursStart: TimeStringSchema,
  quietHoursEnd: TimeStringSchema,
  /** Months to keep guest PII before cron anonymisation (default 24). */
  retentionMonths: z.number().int().min(1).max(120),
});
export type VenueSettings = z.infer<typeof VenueSettingsSchema>;

/** PUT /service/settings — locationId comes from the query, not the body. */
export const VenueSettingsInputSchema = VenueSettingsSchema.omit({
  locationId: true,
}).refine((s) => s.minPartyOnline <= s.maxPartyOnline, {
  message: "minPartyOnline must not exceed maxPartyOnline",
  path: ["minPartyOnline"],
});
export type VenueSettingsInput = z.infer<typeof VenueSettingsInputSchema>;

// ── Floor plan ───────────────────────────────────────────────────────────────

/**
 * A table within a room. `roomId` is deliberately absent — nesting inside the
 * room establishes it, and duplicating it invites the two to disagree.
 */
export const DiningTableSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1).max(16),
  seatsMin: z.number().int().min(1).max(100),
  seatsMax: z.number().int().min(1).max(100),
  shape: TableShapeSchema,
  posX: z.number().int().min(0),
  posY: z.number().int().min(0),
  width: z.number().int().min(1),
  height: z.number().int().min(1),
  rotation: z.number().int().min(0).max(359),
  onlineBookable: z.boolean(),
  assignPriority: z.number().int(),
  isActive: z.boolean(),
  notes: z.string().nullable(),
});
export type DiningTable = z.infer<typeof DiningTableSchema>;

export const RoomSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(64),
  accentColor: z.string().nullable(),
  onlineBookable: z.boolean(),
  canvasWidth: z.number().int().min(100).max(10000),
  canvasHeight: z.number().int().min(100).max(10000),
  sortOrder: z.number().int(),
  isActive: z.boolean(),
  tables: z.array(DiningTableSchema),
});
export type Room = z.infer<typeof RoomSchema>;

export const TableCombinationSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1).max(32),
  seatsMin: z.number().int().min(1).max(100),
  seatsMax: z.number().int().min(1).max(100),
  assignPriority: z.number().int(),
  onlineBookable: z.boolean(),
  isActive: z.boolean(),
  tableIds: z.array(z.string().min(1)).min(2),
});
export type TableCombination = z.infer<typeof TableCombinationSchema>;

export const FloorPlanSchema = z.object({
  rooms: z.array(RoomSchema),
  combinations: z.array(TableCombinationSchema),
});
export type FloorPlan = z.infer<typeof FloorPlanSchema>;

// ── Service periods, turn rules, pacing rules ────────────────────────────────

export const TurnTimeRuleSchema = z.object({
  id: z.string().min(1),
  partyMin: z.number().int().min(1).max(100),
  partyMax: z.number().int().min(1).max(100),
  turnMinutes: z.number().int().min(15).max(600),
});
export type TurnTimeRule = z.infer<typeof TurnTimeRuleSchema>;

export const PacingRuleSchema = z.object({
  id: z.string().min(1),
  intervalMin: z.number().int().min(5).max(120),
  maxCovers: z.number().int().min(0).nullable(),
  maxBookings: z.number().int().min(0).nullable(),
  appliesFrom: TimeStringSchema.nullable(),
  appliesTo: TimeStringSchema.nullable(),
  isActive: z.boolean(),
});
export type PacingRule = z.infer<typeof PacingRuleSchema>;

export const ServicePeriodSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(64),
  dayOfWeek: DayCodeSchema,
  startTime: TimeStringSchema,
  endTime: TimeStringSchema,
  lastSeatingTime: TimeStringSchema,
  slotIntervalMin: z.number().int().min(5).max(120).nullable(),
  onlineBookable: z.boolean(),
  sortOrder: z.number().int(),
  isActive: z.boolean(),
  roomIds: z.array(z.string().min(1)),
  turnRules: z.array(TurnTimeRuleSchema),
  pacingRules: z.array(PacingRuleSchema),
});
export type ServicePeriod = z.infer<typeof ServicePeriodSchema>;

/**
 * Turn and pacing rules are written with their period in one atomic batch, so
 * `id` is server-assigned on create and omitted from the input shapes.
 */
export const TurnTimeRuleInputSchema = TurnTimeRuleSchema.omit({ id: true });
export const PacingRuleInputSchema = PacingRuleSchema.omit({ id: true });

export const ServicePeriodInputSchema = ServicePeriodSchema.omit({
  id: true,
  turnRules: true,
  pacingRules: true,
})
  .extend({
    turnRules: z.array(TurnTimeRuleInputSchema),
    pacingRules: z.array(PacingRuleInputSchema),
  })
  .partial({ sortOrder: true, isActive: true, slotIntervalMin: true });
export type ServicePeriodInput = z.infer<typeof ServicePeriodInputSchema>;

export const ServicePeriodsResponseSchema = z.object({
  periods: z.array(ServicePeriodSchema),
  venueTurnRules: z.array(TurnTimeRuleSchema),
  venuePacingRules: z.array(PacingRuleSchema),
});
export type ServicePeriodsResponse = z.infer<
  typeof ServicePeriodsResponseSchema
>;

// ── Availability exceptions ──────────────────────────────────────────────────

export const AvailabilityExceptionSchema = z.object({
  id: z.string().min(1),
  serviceDate: DateStringSchema,
  kind: ExceptionKindSchema,
  startTime: TimeStringSchema.nullable(),
  endTime: TimeStringSchema.nullable(),
  roomId: z.string().nullable(),
  tableId: z.string().nullable(),
  overrideLastSeating: TimeStringSchema.nullable(),
  note: z.string().nullable(),
});
export type AvailabilityException = z.infer<
  typeof AvailabilityExceptionSchema
>;

export const AvailabilityExceptionInputSchema =
  AvailabilityExceptionSchema.omit({ id: true });
export type AvailabilityExceptionInput = z.infer<
  typeof AvailabilityExceptionInputSchema
>;

// ── Reservations ─────────────────────────────────────────────────────────────

export const ReservationStatusSchema = z.enum(RESERVATION_STATUSES);
export const ReservationSourceSchema = z.enum(RESERVATION_SOURCES);

export const ReservationSchema = z.object({
  id: z.string().min(1),
  locationId: z.string().min(1),
  reference: z.string().min(1),
  contactId: z.string().nullable(),
  guestName: z.string().min(1).max(120),
  guestPhone: z.string().nullable(),
  guestEmail: z.string().nullable(),
  partySize: z.number().int().min(1).max(100),
  serviceDate: DateStringSchema,
  startTime: TimeStringSchema,
  endTime: TimeStringSchema,
  startsAtUtc: z.string(),
  servicePeriodId: z.string().nullable(),
  roomId: z.string().nullable(),
  status: ReservationStatusSchema,
  source: ReservationSourceSchema,
  assignmentLocked: z.boolean(),
  occasion: z.string().nullable(),
  allergies: z.string().nullable(),
  guestNotes: z.string().nullable(),
  staffNotes: z.string().nullable(),
  tags: z.array(z.string()),
  depositRequiredPence: z.number().int(),
  seatedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  cancelledAt: z.string().nullable(),
  cancelReason: z.string().nullable(),
  noShowMarkedAt: z.string().nullable(),
  marketingOptIn: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
  tableIds: z.array(z.string()),
});
export type Reservation = z.infer<typeof ReservationSchema>;

export const CreateReservationInputSchema = z.object({
  guestName: z.string().min(1).max(120),
  guestPhone: z.string().min(1).nullable().optional(),
  guestEmail: z.string().email().nullable().optional(),
  partySize: z.number().int().min(1).max(100),
  serviceDate: DateStringSchema,
  startTime: TimeStringSchema,
  source: ReservationSourceSchema.optional(),
  /** Explicit tables. Omit to let the assignment engine choose. */
  tableIds: z.array(z.string().min(1)).optional(),
  occasion: z.string().max(120).nullable().optional(),
  allergies: z.string().max(500).nullable().optional(),
  guestNotes: z.string().max(2000).nullable().optional(),
  staffNotes: z.string().max(2000).nullable().optional(),
  tags: z.array(z.string().min(1).max(40)).optional(),
  marketingOptIn: z.boolean().optional(),
});
export type CreateReservationInput = z.infer<
  typeof CreateReservationInputSchema
>;

export const PatchReservationInputSchema = z
  .object({
    partySize: z.number().int().min(1).max(100),
    serviceDate: DateStringSchema,
    startTime: TimeStringSchema,
    guestName: z.string().min(1).max(120),
    guestPhone: z.string().nullable(),
    guestEmail: z.string().nullable(),
    occasion: z.string().max(120).nullable(),
    allergies: z.string().max(500).nullable(),
    guestNotes: z.string().max(2000).nullable(),
    staffNotes: z.string().max(2000).nullable(),
    tags: z.array(z.string().min(1).max(40)),
  })
  .partial();
export type PatchReservationInput = z.infer<typeof PatchReservationInputSchema>;

export const RESERVATION_STATUS_ACTIONS = [
  "seat",
  "finish",
  "no_show",
  "cancel",
  "reinstate",
] as const;
export type ReservationStatusAction =
  (typeof RESERVATION_STATUS_ACTIONS)[number];

export const ReservationStatusInputSchema = z.object({
  action: z.enum(RESERVATION_STATUS_ACTIONS),
  reason: z.string().max(500).nullable().optional(),
});

export const AssignTablesInputSchema = z.object({
  tableIds: z.array(z.string().min(1)).min(1),
  /** Atomically exchange tables with this booking (same service date). */
  swapWithReservationId: z.string().min(1).optional(),
});

export const ReservationEventSchema = z.object({
  id: z.string(),
  type: z.string(),
  actor: z.string(),
  data: z.unknown().nullable(),
  createdAt: z.string(),
});
export type ReservationEvent = z.infer<typeof ReservationEventSchema>;

// ── Guest profiles ───────────────────────────────────────────────────────────

export const RELIABILITY_CHIPS = ["good", "watch", "risk"] as const;
export type ReliabilityChip = (typeof RELIABILITY_CHIPS)[number];

export const GuestProfileSchema = z.object({
  contactId: z.string().min(1),
  vip: z.boolean(),
  allergies: z.string().nullable(),
  dietary: z.string().nullable(),
  seatingPreference: z.string().nullable(),
  notes: z.string().nullable(),
  visitCount: z.number().int(),
  noShowCount: z.number().int(),
  cancelCount: z.number().int(),
  lifetimeCovers: z.number().int(),
  reliabilityScore: z.number().int().min(0).max(100),
  reliabilityChip: z.enum(RELIABILITY_CHIPS),
  lastVisitAt: z.string().nullable(),
  firstVisitAt: z.string().nullable(),
  marketingOptIn: z.boolean(),
  marketingOptInAt: z.string().nullable(),
  blocked: z.boolean(),
  blockedReason: z.string().nullable(),
  updatedAt: z.string(),
});
export type GuestProfile = z.infer<typeof GuestProfileSchema>;

export const GuestProfilePatchSchema = z
  .object({
    vip: z.boolean(),
    allergies: z.string().max(500).nullable(),
    dietary: z.string().max(500).nullable(),
    seatingPreference: z.string().max(200).nullable(),
    notes: z.string().max(2000).nullable(),
    blocked: z.boolean(),
    blockedReason: z.string().max(500).nullable(),
  })
  .partial();
export type GuestProfilePatch = z.infer<typeof GuestProfilePatchSchema>;

// ── Payments (deposits) ──────────────────────────────────────────────────────

export const PAYMENT_STATUSES = [
  "requires_action",
  "saved",
  "authorized",
  "succeeded",
  "failed",
  "refunded",
  "cancelled",
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const PaymentSummarySchema = z.object({
  id: z.string().min(1),
  reservationId: z.string().nullable(),
  status: z.enum(PAYMENT_STATUSES),
  amountPence: z.number().int(),
  currency: z.string(),
  checkoutUrl: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type PaymentSummary = z.infer<typeof PaymentSummarySchema>;

// ── Error envelope for /service/* and /book/* (spec §14) ─────────────────────

export const ServiceErrorSchema = z.object({
  error: z.string(),
  code: z.string(),
  details: z.unknown().optional(),
});
export type ServiceError = z.infer<typeof ServiceErrorSchema>;
