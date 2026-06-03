import { z } from "zod";

export const IntakeFormSchema = z.object({
  name: z.string().min(2, "Name is required"),
  phone: z.string().min(8, "Phone number is required"),
  locationId: z.string().min(2, "Please select an academy"),
  interest: z.string().min(2, "Please select a programme"),
  childName: z.string().optional(),
  childAge: z.union([z.string(), z.number()]).optional(),
  experience: z.enum(["First-timer", "Some experience"]).optional(),
  email: z
    .string()
    .optional()
    .refine((v) => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), {
      message: "Invalid email",
    }),
});

export type IntakeFormInput = z.infer<typeof IntakeFormSchema>;

export const IntakeResponseSchema = z.object({
  ok: z.boolean(),
  leadId: z.string(),
  isNew: z.boolean(),
  queued: z.boolean(),
  message: z.string().optional(),
});

export type IntakeResponse = z.infer<typeof IntakeResponseSchema>;
