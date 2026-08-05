import { handleQueueBatch } from "./queue/consumer";
import { optionsResponse, jsonResponse } from "./cors";
import { verifySchemaVersion } from "./meta";
import { handleHealth } from "./routes/health";
import { handleAdminSeed } from "./routes/admin";
import { handleListLeads, handleGetLead, handleSelectLead, handleTakeover, handleResumeAi, handleSimulateNewLead, handleDeleteLead, handleSendStaffMessage, handleAddLeadNote } from "./routes/leads";
import { handleEventStream } from "./routes/events";
import { getStaffSession } from "./auth/session";
import { adminSecretAuthorized } from "./auth/admin-secret";
import { handleMagicLink, handleVerify, handleLogout, handleMe, handleUpdateProfile, handleListTeam, handleInviteTeam } from "./routes/auth";
import { handleTelnyxWebhook } from "./routes/webhooks";
import { handleTwilioInbound, handleTwilioStatus } from "./routes/twilio";
import { handleTwilioCheck } from "./routes/twilio-admin";
import {
  handleAiConfig,
  handleAiStatus,
  handleApplyAiPreset,
  handleIngestKnowledge,
  handlePatchAiConfig,
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
import { handleCapabilities } from "./routes/capabilities-admin";
import {
  handleCreateException,
  handleCreateServicePeriod,
  handleDeleteException,
  handleDeleteServicePeriod,
  handleGetExceptions,
  handleGetFloorPlan,
  handleGetServicePeriods,
  handleGetServiceSettings,
  handlePatchServicePeriod,
  handlePutFloorPlan,
  handlePutServiceSettings,
} from "./routes/service";
import {
  handleAssignTables,
  handleCreateReservation,
  handleGetAvailability,
  handleGetReservation,
  handlePatchReservation,
  handleReservationStatus,
} from "./routes/reservations";
import { serviceEnabled } from "./capabilities";
import type { Env, QueueMessage } from "./env";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") return optionsResponse(request, env);

    const url = new URL(request.url);
    const path = url.pathname;

    if (env.ENABLE_DEMO_TOOLS === "true") {
      console.warn(
        `[${env.ORGANIZATION_ID}] ⚠️ DEMO TOOLS ARE ENABLED. Disable for production: set ENABLE_DEMO_TOOLS=false in wrangler.toml`
      );
    }

    // /health must work even when schema check fails (diagnostics)
    if (path === "/health") {
      return handleHealth(request, env);
    }

    try {
      await verifySchemaVersion(env);
    } catch (e) {
      return new Response(
        JSON.stringify({
          error: "Service unavailable: schema mismatch",
          details: String(e),
        }),
        { status: 503, headers: { "Content-Type": "application/json" } }
      );
    }

    try {
      // ── Public (unauthenticated) endpoints ──────────────────────────────
      // Everything else requires a valid staff session cookie. /auth/* routes
      // are listed as public because they manage their own session checks
      // internally (and magic-link/verify must be reachable while logged out).
      const isPublic =
        (path === "/leads/intake" && request.method === "POST") ||
        (path === "/admin/ingest-knowledge" && request.method === "POST") ||
        path.startsWith("/auth/") ||
        path.startsWith("/webhooks/");

      if (!isPublic) {
        const session = await getStaffSession(env, request);
        // X-Admin-Secret is an operator-script bypass, valid ONLY for /admin/*.
        // All other routes require a real staff session.
        const adminBypass =
          path.startsWith("/admin/") && adminSecretAuthorized(request, env);
        if (!session && !adminBypass) {
          return jsonResponse(request, env, { error: "Unauthorized" }, 401);
        }
      }

      if (path === "/admin/seed" && request.method === "POST") {
        if (env.ENABLE_DEMO_TOOLS !== "true") {
          return jsonResponse(request, env, { error: "Demo tools disabled" }, 403);
        }
        return handleAdminSeed(request, env);
      }

      if (path === "/admin/twilio-check" && request.method === "GET") {
        return handleTwilioCheck(request, env);
      }

      if (path === "/admin/capabilities" && request.method === "GET") {
        return handleCapabilities(request, env);
      }

      if (path === "/admin/ai-config" && request.method === "GET") {
        return handleAiConfig(request, env);
      }

      if (path === "/admin/ai-config" && request.method === "PATCH") {
        return handlePatchAiConfig(request, env);
      }

      if (path === "/admin/ai-config/apply-preset" && request.method === "POST") {
        return handleApplyAiPreset(request, env);
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

      // ── Service module (flag off → falls through to 404) ────────────────
      if (serviceEnabled(env) && path.startsWith("/service/")) {
        if (path === "/service/settings" && request.method === "GET") {
          return handleGetServiceSettings(request, env);
        }
        if (path === "/service/settings" && request.method === "PUT") {
          return handlePutServiceSettings(request, env);
        }

        if (path === "/service/floor-plan" && request.method === "GET") {
          return handleGetFloorPlan(request, env);
        }
        if (path === "/service/floor-plan" && request.method === "PUT") {
          return handlePutFloorPlan(request, env);
        }

        if (path === "/service/periods" && request.method === "GET") {
          return handleGetServicePeriods(request, env);
        }
        if (path === "/service/periods" && request.method === "POST") {
          return handleCreateServicePeriod(request, env);
        }

        const periodMatch = path.match(/^\/service\/periods\/([^/]+)$/);
        if (periodMatch && request.method === "PATCH") {
          return handlePatchServicePeriod(request, env, periodMatch[1]);
        }
        if (periodMatch && request.method === "DELETE") {
          return handleDeleteServicePeriod(request, env, periodMatch[1]);
        }

        if (path === "/service/exceptions" && request.method === "GET") {
          return handleGetExceptions(request, env);
        }
        if (path === "/service/exceptions" && request.method === "POST") {
          return handleCreateException(request, env);
        }

        const exceptionMatch = path.match(/^\/service\/exceptions\/([^/]+)$/);
        if (exceptionMatch && request.method === "DELETE") {
          return handleDeleteException(request, env, exceptionMatch[1]);
        }

        if (path === "/service/availability" && request.method === "GET") {
          return handleGetAvailability(request, env);
        }

        if (path === "/service/reservations" && request.method === "POST") {
          return handleCreateReservation(request, env);
        }

        // Specific sub-resources before the bare :id, or /tables and /status
        // are swallowed by the id pattern.
        const assignMatch = path.match(
          /^\/service\/reservations\/([^/]+)\/tables$/
        );
        if (assignMatch && request.method === "PUT") {
          return handleAssignTables(request, env, assignMatch[1]);
        }

        const statusMatch = path.match(
          /^\/service\/reservations\/([^/]+)\/status$/
        );
        if (statusMatch && request.method === "POST") {
          return handleReservationStatus(request, env, statusMatch[1]);
        }

        const reservationMatch = path.match(/^\/service\/reservations\/([^/]+)$/);
        if (reservationMatch && request.method === "GET") {
          return handleGetReservation(request, env, reservationMatch[1]);
        }
        if (reservationMatch && request.method === "PATCH") {
          return handlePatchReservation(request, env, reservationMatch[1]);
        }
      }

      if (path === "/leads" && request.method === "GET") {
        return handleListLeads(request, env);
      }

      if (path === "/leads/simulate" && request.method === "POST") {
        if (env.ENABLE_DEMO_TOOLS !== "true") {
          return jsonResponse(request, env, { error: "Demo tools disabled" }, 403);
        }
        return handleSimulateNewLead(request, env);
      }

      if (path === "/leads/intake" && request.method === "POST") {
        return handleIntakeSubmit(request, env);
      }

      if (path === "/events/stream" && request.method === "GET") {
        return handleEventStream(request, env);
      }

      if (path === "/auth/magic-link" && request.method === "POST") {
        return handleMagicLink(request, env);
      }

      if (path === "/auth/verify" && request.method === "GET") {
        return handleVerify(request, env);
      }

      if (path === "/auth/logout" && request.method === "POST") {
        return handleLogout(request, env);
      }

      if (path === "/auth/me" && request.method === "GET") {
        return handleMe(request, env);
      }

      if (path === "/auth/profile" && request.method === "PATCH") {
        return handleUpdateProfile(request, env);
      }

      if (path === "/auth/team" && request.method === "GET") {
        return handleListTeam(request, env);
      }

      if (path === "/auth/team/invite" && request.method === "POST") {
        return handleInviteTeam(request, env);
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

      const notesMatch = path.match(/^\/leads\/([^/]+)\/notes$/);
      if (notesMatch && request.method === "POST") {
        return handleAddLeadNote(request, env, notesMatch[1]);
      }

      const staffMsgMatch = path.match(/^\/leads\/([^/]+)\/messages$/);
      if (staffMsgMatch && request.method === "POST") {
        return handleSendStaffMessage(request, env, staffMsgMatch[1]);
      }

      const selectMatch = path.match(/^\/leads\/([^/]+)\/select$/);
      if (selectMatch && request.method === "POST") {
        return handleSelectLead(request, env, selectMatch[1]);
      }

      const takeoverMatch = path.match(/^\/leads\/([^/]+)\/takeover$/);
      if (takeoverMatch && request.method === "POST") {
        return handleTakeover(request, env, takeoverMatch[1]);
      }

      const resumeAiMatch = path.match(/^\/leads\/([^/]+)\/resume-ai$/);
      if (resumeAiMatch && request.method === "POST") {
        return handleResumeAi(request, env, resumeAiMatch[1]);
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
