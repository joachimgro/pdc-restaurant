import { z } from "zod";

export const AiGenerateOutputSchema = z.object({
  reply: z.string().min(1).max(500),
  stage: z.string().min(1),
  verdict: z.enum(["Approved", "Rewrite", "Hold"]).optional(),
  note: z.string().min(1),
  assessment: z.string().min(1),
  status: z
    .enum(["new", "engaged", "qualified", "booked", "waiting", "cold"])
    .optional(),
  statusLabel: z.string().optional(),
});

export type AiGenerateOutput = z.infer<typeof AiGenerateOutputSchema>;

export const AiJudgeOutputSchema = z.object({
  verdict: z.enum(["Approved", "Rewrite", "Hold"]),
  stage: z.string().min(1),
  note: z.string().min(1),
  finalReply: z.string().min(1).max(500).optional(),
});

export type AiJudgeOutput = z.infer<typeof AiJudgeOutputSchema>;

export function parseJsonFromModel(raw: string): unknown {
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) text = fence[1].trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) text = text.slice(start, end + 1);
  return JSON.parse(text) as unknown;
}
