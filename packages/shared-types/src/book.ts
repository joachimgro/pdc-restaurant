import { z } from "zod";
import { DateStringSchema, TimeStringSchema } from "./service";

export const BookHoldInputSchema = z.object({
  partySize: z.number().int().min(1).max(100),
  serviceDate: DateStringSchema,
  startTime: TimeStringSchema,
  turnstileToken: z.string().optional(),
});
export type BookHoldInput = z.infer<typeof BookHoldInputSchema>;

export const BookReserveInputSchema = z.object({
  holdToken: z.string().min(1),
  guestName: z.string().min(1).max(120),
  guestPhone: z.string().min(5).max(40).optional(),
  guestEmail: z.string().email().optional(),
  occasion: z.string().max(120).nullable().optional(),
  allergies: z.string().max(500).nullable().optional(),
  guestNotes: z.string().max(2000).nullable().optional(),
  marketingOptIn: z.boolean().optional(),
  turnstileToken: z.string().optional(),
});
export type BookReserveInput = z.infer<typeof BookReserveInputSchema>;

export const BookModifyInputSchema = z.object({
  holdToken: z.string().min(1),
  partySize: z.number().int().min(1).max(100).optional(),
  guestName: z.string().min(1).max(120).optional(),
  guestPhone: z.string().min(5).max(40).nullable().optional(),
  guestEmail: z.string().email().nullable().optional(),
  occasion: z.string().max(120).nullable().optional(),
  allergies: z.string().max(500).nullable().optional(),
  guestNotes: z.string().max(2000).nullable().optional(),
  turnstileToken: z.string().optional(),
});
export type BookModifyInput = z.infer<typeof BookModifyInputSchema>;

export const BookCancelInputSchema = z.object({
  reason: z.string().max(500).nullable().optional(),
});
