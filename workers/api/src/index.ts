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
import {
  handleMagicLinkRequest,
  handleMagicLinkVerify,
  handleLogout,
  handleMe,
} from "./routes/auth";
import {
  handleListAdmins,
  handleAddAdmin,
  handleRemoveAdmin,
} from "./routes/admins";
import { requireAuth } from "./auth/middleware";
import type { Env, QueueMessage } from "./env";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") return optionsResponse(request, env);

    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    try {
      if (path === "/health") {
        return jsonResponse(request, env, { ok: true });
      }

      // ── Public routes: intake form and webhooks ───────────────────────────
      if (path === "/leads/intake" && method === "POST") {
        return handleIntakeSubmit(request, env);
      }

      if (path === "/locations" && method === "GET") {
        const { results } = await env.DB.prepare(
          `SELECT id, name, abbrev, badge_count FROM locations WHERE organization_id = ?`
        )
          .bind(env.ORGANIZATION_ID)
          .all();
        return jsonResponse(request, env, { locations: results ?? [] });
      }

      if (path === "/webhooks/telnyx" && method === "POST") {
        return handleTelnyxWebhook(request, env);
      }

      if (path === "/webhooks/twilio" && method === "POST") {
        return handleTwilioInbound(request, env);
      }

      if (path === "/webhooks/twilio/status" && method === "POST") {
        return handleTwilioStatus(request, env);
      }

      // ── Auth routes (public — no session required) ────────────────────────
      if (path === "/auth/magic-link" && method === "POST") {
        return handleMagicLinkRequest(request, env);
      }

      if (path === "/auth/verify" && method === "POST") {
        return handleMagicLinkVerify(request, env);
      }

      if (path === "/auth/logout" && method === "POST") {
        return handleLogout(request, env);
      }

      if (path === "/auth/me" && method === "GET") {
        return handleMe(request, env);
      }

      // ── Everything below requires a valid session ─────────────────────────
      const auth = await requireAuth(request, env);
      if (auth instanceof Response) return auth;

      // ── Demo-only tools (additionally gated by ENABLE_DEMO_TOOLS) ─────────
      if (path === "/admin/seed" && method === "POST") {
        if (env.ENABLE_DEMO_TOOLS !== "true") {
          return jsonResponse(request, env, { error: "Demo tools are disabled" }, 403);
        }
        return handleAdminSeed(request, env);
      }

      if (path === "/admin/reset-all" && method === "POST") {
        if (env.ENABLE_DEMO_TOOLS !== "true") {
          return jsonResponse(request, env, { error: "Demo tools are disabled" }, 403);
        }
        return handleAdminResetAll(request, env);
      }

      if (path === "/leads/simulate" && method === "POST") {
        if (env.ENABLE_DEMO_TOOLS !== "true") {
          return jsonResponse(request, env, { error: "Demo tools are disabled" }, 403);
        }
        return handleSimulateNewLead(request, env);
      }

      // ── Admin management ──────────────────────────────────────────────────
      if (path === "/admin/admins" && method === "GET") {
        return handleListAdmins(request, env);
      }

      if (path === "/admin/admins" && method === "POST") {
        return handleAddAdmin(request, env, auth.email);
      }

      const adminEmailMatch = path.match(/^\/admin\/admins\/([^/]+)$/);
      if (adminEmailMatch && method === "DELETE") {
        return handleRemoveAdmin(request, env, decodeURIComponent(adminEmailMatch[1]));
      }

      // ── Twilio admin ──────────────────────────────────────────────────────
      if (path === "/admin/twilio-check" && method === "GET") {
        return handleTwilioCheck(request, env);
      }

      // ── AI admin ──────────────────────────────────────────────────────────
      if (path === "/admin/ai-config" && method === "GET") {
        return handleAiConfig(request, env);
      }

      if (path === "/admin/ai-status" && method === "GET") {
        return handleAiStatus(request, env);
      }

      if (path === "/admin/ingest-knowledge" && method === "POST") {
        return handleIngestKnowledge(request, env);
      }

      // ── Knowledge admin ───────────────────────────────────────────────────
      if (path === "/admin/knowledge" && method === "GET") {
        return handleListKnowledge(request, env);
      }

      if (path === "/admin/knowledge" && method === "POST") {
        return handleCreateKnowledge(request, env);
      }

      if (path === "/admin/knowledge/reindex" && method === "POST") {
        return handleReindexKnowledge(request, env);
      }

      if (path === "/admin/knowledge/preview" && method === "POST") {
        return handlePreviewKnowledge(request, env);
      }

      const knowledgeDeleteMatch = path.match(/^\/admin\/knowledge\/([^/]+)$/);
      if (knowledgeDeleteMatch && method === "DELETE") {
        return handleDeleteKnowledge(request, env, knowledgeDeleteMatch[1]);
      }

      // ── Locations admin ───────────────────────────────────────────────────
      if (path === "/admin/locations" && method === "GET") {
        return handleListAdminLocations(request, env);
      }

      if (path === "/admin/locations" && method === "POST") {
        return handleCreateLocation(request, env);
      }

      const adminLocMatch = path.match(/^\/admin\/locations\/([^/]+)$/);
      if (adminLocMatch && method === "PUT") {
        return handleUpdateLocation(request, env, adminLocMatch[1]);
      }

      const adminSchedMatch = path.match(/^\/admin\/locations\/([^/]+)\/schedules$/);
      if (adminSchedMatch && method === "PUT") {
        return handlePutLocationSchedules(request, env, adminSchedMatch[1]);
      }

      const adminSyncMatch = path.match(/^\/admin\/locations\/([^/]+)\/sync-schedules$/);
      if (adminSyncMatch && method === "POST") {
        return handleSyncLocationSchedules(request, env, adminSyncMatch[1]);
      }

      // ── Leads ─────────────────────────────────────────────────────────────
      if (path === "/leads" && method === "GET") {
        return handleListLeads(request, env);
      }

      // SSE stream — token can be passed as ?token= query param (EventSource limitation)
      if (path === "/events/stream" && method === "GET") {
        return handleEventStream(request, env);
      }

      const selectMatch = path.match(/^\/leads\/([^/]+)\/select$/);
      if (selectMatch && method === "POST") {
        return handleSelectLead(request, env, selectMatch[1]);
      }

      const takeoverMatch = path.match(/^\/leads\/([^/]+)\/takeover$/);
      if (takeoverMatch && method === "POST") {
        return handleTakeover(request, env, takeoverMatch[1]);
      }

      const leadMatch = path.match(/^\/leads\/([^/]+)$/);
      if (leadMatch && method === "GET") {
        return handleGetLead(request, env, leadMatch[1]);
      }
      if (leadMatch && method === "DELETE") {
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
