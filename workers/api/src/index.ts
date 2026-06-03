import { handleQueueBatch } from "./queue/consumer";
import { optionsResponse, jsonResponse } from "./cors";
import { handleAdminResetAll, handleAdminSeed } from "./routes/admin";
import { handleListLeads, handleGetLead, handleSelectLead, handleTakeover, handleSimulateNewLead, handleDeleteLead } from "./routes/leads";
import { handleEventStream } from "./routes/events";
import { handleTelnyxWebhook } from "./routes/webhooks";
import { handleTwilioInbound, handleTwilioStatus } from "./routes/twilio";
import { handleTwilioCheck } from "./routes/twilio-admin";
import {
  handleAiConfig,
  handleAiStatus,
  handleIngestKnowledge,
} from "./routes/ai-admin";
import { handleIntakeSubmit } from "./routes/intake";
import {
  handleCreateKnowledge,
  handleDeleteKnowledge,
  handleListKnowledge,
  handlePreviewKnowledge,
  handleReindexKnowledge,
} from "./routes/knowledge-admin";
import {
  handleCreateLocation,
  handleListAdminLocations,
  handlePutLocationSchedules,
  handleSyncLocationSchedules,
  handleUpdateLocation,
} from "./routes/locations-admin";
import type { Env, QueueMessage } from "./env";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") return optionsResponse(request, env);

    const url = new URL(request.url);
    const path = url.pathname;

    try {
      if (path === "/health") {
        return jsonResponse(request, env, { ok: true });
      }

      if (path === "/admin/seed" && request.method === "POST") {
        if (env.ENABLE_DEMO_TOOLS !== "true") {
          return jsonResponse(request, env, { error: "Demo tools are disabled" }, 403);
        }
        return handleAdminSeed(request, env);
      }

      if (path === "/admin/reset-all" && request.method === "POST") {
        if (env.ENABLE_DEMO_TOOLS !== "true") {
          return jsonResponse(request, env, { error: "Demo tools are disabled" }, 403);
        }
        return handleAdminResetAll(request, env);
      }

      if (path === "/admin/twilio-check" && request.method === "GET") {
        return handleTwilioCheck(request, env);
      }

      if (path === "/admin/ai-config" && request.method === "GET") {
        return handleAiConfig(request, env);
      }

      if (path === "/admin/ai-status" && request.method === "GET") {
        return handleAiStatus(request, env);
      }

      if (path === "/admin/ingest-knowledge" && request.method === "POST") {
        return handleIngestKnowledge(request, env);
      }

      if (path === "/admin/knowledge" && request.method === "GET") {
        return handleListKnowledge(request, env);
      }

      if (path === "/admin/knowledge" && request.method === "POST") {
        return handleCreateKnowledge(request, env);
      }

      if (path === "/admin/knowledge/reindex" && request.method === "POST") {
        return handleReindexKnowledge(request, env);
      }

      if (path === "/admin/knowledge/preview" && request.method === "POST") {
        return handlePreviewKnowledge(request, env);
      }

      const knowledgeDeleteMatch = path.match(
        /^\/admin\/knowledge\/([^/]+)$/
      );
      if (knowledgeDeleteMatch && request.method === "DELETE") {
        return handleDeleteKnowledge(request, env, knowledgeDeleteMatch[1]);
      }

      if (path === "/locations" && request.method === "GET") {
        const { results } = await env.DB.prepare(
          `SELECT id, name, abbrev, badge_count FROM locations WHERE organization_id = ?`
        )
          .bind(env.ORGANIZATION_ID)
          .all();
        return jsonResponse(request, env, { locations: results ?? [] });
      }

      if (path === "/admin/locations" && request.method === "GET") {
        return handleListAdminLocations(request, env);
      }

      if (path === "/admin/locations" && request.method === "POST") {
        return handleCreateLocation(request, env);
      }

      const adminLocMatch = path.match(/^\/admin\/locations\/([^/]+)$/);
      if (adminLocMatch && request.method === "PUT") {
        return handleUpdateLocation(request, env, adminLocMatch[1]);
      }

      const adminSchedMatch = path.match(
        /^\/admin\/locations\/([^/]+)\/schedules$/
      );
      if (adminSchedMatch && request.method === "PUT") {
        return handlePutLocationSchedules(request, env, adminSchedMatch[1]);
      }

      const adminSyncMatch = path.match(
        /^\/admin\/locations\/([^/]+)\/sync-schedules$/
      );
      if (adminSyncMatch && request.method === "POST") {
        return handleSyncLocationSchedules(request, env, adminSyncMatch[1]);
      }

      if (path === "/leads" && request.method === "GET") {
        return handleListLeads(request, env);
      }

      if (path === "/leads/simulate" && request.method === "POST") {
        if (env.ENABLE_DEMO_TOOLS !== "true") {
          return jsonResponse(request, env, { error: "Demo tools are disabled" }, 403);
        }
        return handleSimulateNewLead(request, env);
      }

      if (path === "/leads/intake" && request.method === "POST") {
        return handleIntakeSubmit(request, env);
      }

      if (path === "/events/stream" && request.method === "GET") {
        return handleEventStream(request, env);
      }

      if (path === "/webhooks/telnyx" && request.method === "POST") {
        return handleTelnyxWebhook(request, env);
      }

      if (path === "/webhooks/twilio" && request.method === "POST") {
        return handleTwilioInbound(request, env);
      }

      if (path === "/webhooks/twilio/status" && request.method === "POST") {
        return handleTwilioStatus(request, env);
      }

      const selectMatch = path.match(/^\/leads\/([^/]+)\/select$/);
      if (selectMatch && request.method === "POST") {
        return handleSelectLead(request, env, selectMatch[1]);
      }

      const takeoverMatch = path.match(/^\/leads\/([^/]+)\/takeover$/);
      if (takeoverMatch && request.method === "POST") {
        return handleTakeover(request, env, takeoverMatch[1]);
      }

      const leadMatch = path.match(/^\/leads\/([^/]+)$/);
      if (leadMatch && request.method === "GET") {
        return handleGetLead(request, env, leadMatch[1]);
      }
      if (leadMatch && request.method === "DELETE") {
        return handleDeleteLead(request, env, leadMatch[1]);
      }

      return jsonResponse(request, env, { error: "Not found" }, 404);
    } catch (e) {
      console.error(e);
      return jsonResponse(
        request,
        env,
        { error: e instanceof Error ? e.message : "Internal error" },
        500
      );
    }
  },

  async queue(batch: MessageBatch<QueueMessage>, env: Env): Promise<void> {
    await handleQueueBatch(batch, env);
  },
};
