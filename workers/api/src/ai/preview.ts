import { getAiConfig } from "../db/ai-config";
import { getLocationNameById } from "../db/locations";
import type { Env } from "../env";
import { simpleSchedulingEnabled } from "../capabilities";
import {
  buildRagQuery,
  retrieveKnowledge,
  ragEnabled,
} from "./rag";
import { buildCurrentTurnPrompt, buildSystemPrompt } from "./prompt";
import type { ConversationContext } from "./context";
import { buildStructuredHistoryForLlm } from "./context";
import { intakeContextLabelFromConfig } from "../db/ai-config";
import { buildLeadIntakeContextBlock, pickScheduleLine } from "./intake-context";
import type { Lead } from "@lead-intake/shared-types";
import { parseGenerateOutput } from "./parse-output";
import { aiEnabled, runChatModel } from "./workers-ai";

const LOCATION_NAMES: Record<string, string> = {};

export interface KnowledgePreviewInput {
  query: string;
  locationId?: string;
  interest?: string;
}

export interface KnowledgePreviewResult {
  chunks: {
    id: string;
    title: string;
    text: string;
    locationId: string | null;
    source: string;
    score: number;
  }[];
  sampleReply: string | null;
  ragEnabled: boolean;
  aiEnabled: boolean;
}

export async function previewKnowledge(
  env: Env,
  input: KnowledgePreviewInput
): Promise<KnowledgePreviewResult> {
  const locationId = input.locationId?.trim() || undefined;
  const locationName =
    (locationId && (await getLocationNameById(env, locationId))) ||
    (locationId && LOCATION_NAMES[locationId]) ||
    "our location";
  const interest = input.interest?.trim() || "classes";
  const queryText = buildRagQuery(input.query, interest, locationName);

  const chunks = ragEnabled(env)
    ? await retrieveKnowledge(
        env,
        env.ORGANIZATION_ID,
        locationId,
        queryText,
        6
      )
    : [];

  let sampleReply: string | null = null;

  if (aiEnabled(env) && chunks.length >= 0) {
    try {
      const aiConfig = await getAiConfig(env);
      const lead: Lead = {
        id: "preview",
        name: "Preview User",
        phone: "",
        time: "now",
        location: locationName,
        locationId,
        status: "new",
        statusLabel: "New",
        assessment: "Preview test",
        preview: input.query.slice(0, 48),
        unread: false,
        source: "Knowledge preview",
        interest,
        messages: [
          {
            kind: "chat",
            from: "lead",
            text: input.query,
            time: "now",
          },
        ],
        timeline: [],
        notes: [],
      };
      const scheduling = simpleSchedulingEnabled(env);
      const scheduleLine = pickScheduleLine(lead, chunks, null);
      const ctx: ConversationContext = {
        lead,
        inboundText: input.query,
        history: [{ role: "lead", text: input.query }],
        locationOverride: null,
        aiConfig,
        intakeContextBlock: buildLeadIntakeContextBlock(
          lead,
          scheduleLine,
          null,
          scheduling
        ),
        scheduleLine,
        dbSchedule: null,
      };

      const structuredHistory = buildStructuredHistoryForLlm(
        ctx.history,
        input.query,
        intakeContextLabelFromConfig(ctx.aiConfig)
      );
      const raw = await runChatModel(
        env,
        aiConfig.model_reply,
        [
          {
            role: "system",
            content: buildSystemPrompt(aiConfig, null, chunks, ctx.intakeContextBlock, {
              schedulingEnabled: scheduling,
              presetId: aiConfig.preset_id,
            }),
          },
          ...structuredHistory,
          {
            role: "user",
            content: buildCurrentTurnPrompt(ctx, input.query, {
              schedulingEnabled: scheduling,
            }),
          },
        ],
        400,
        0.55
      );

      const parsed = parseGenerateOutput(raw, "Preview");
      sampleReply = parsed?.reply.trim() ?? null;
    } catch (e) {
      console.error("Preview generate failed", e);
      sampleReply = null;
    }
  }

  return {
    chunks: chunks.map((c) => ({
      id: c.id,
      title: c.title,
      text: c.text,
      locationId: c.locationId,
      source: c.source,
      score: c.score,
    })),
    sampleReply,
    ragEnabled: ragEnabled(env),
    aiEnabled: aiEnabled(env),
  };
}
