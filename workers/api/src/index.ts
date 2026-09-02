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
  handleGetServiceDay,
  handleGetReservation,
  handlePatchReservation,
  handleReservationStatus,
} from "./routes/reservations";
import { handleGetServiceStats } from "./routes/stats";
import {
  handleCreateKitchenOrder,
  handleCreateKitchenTicket,
  handleCreateMenuCategory,
  handleCreateMenuItem,
  handleDeleteMenuItem,
  handleGetKitchenMenu,
  handleImportKitchenMenu,
  handleKitchenTicketStatus,
  handleListKitchenTickets,
  handleMenuItemAvailability,
  handleParseMenuImage,
  handleReorderKitchenMenu,
} from "./routes/kitchen";
import {
  handleFlagGuestThread,
  handleGetGuestThread,
  handleGetReservationContact,
  handleListGuestThreads,
  handleMuteGuestThread,
  handlePostReservationContact,
  handleUnmuteGuestThread,
} from "./routes/guest-threads";
import {
  handleConvertWaitlist,
  handleCreateWaitlist,
  handleListWaitlist,
  handleNotifyWaitlist,
  handleRemoveWaitlist,
} from "./routes/waitlist";
import {
  handleEraseGuest,
  handleExportGuest,
  handleGetGuestProfileByEmail,
  handlePatchGuestProfile,
  handlePatchReservationGuestProfile,
} from "./routes/guests";
import { handleStripeWebhook } from "./routes/stripe-webhook";
import { kitchenEnabled, serviceEnabled } from "./capabilities";
import type { Env, QueueMessage } from "./env";
import { handleBookRoutes } from "./routes/book";
import { handleResendWebhook } from "./routes/resend-inbound";
import { runScheduledJobs } from "./cron/dispatcher";

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
      // Demo endpoints refuse closed before auth so operators can prove the
      // flag without holding ADMIN_SEED_SECRET / a staff session.
      if (
        env.ENABLE_DEMO_TOOLS !== "true" &&
        ((path === "/admin/seed" && request.method === "POST") ||
          (path === "/leads/simulate" && request.method === "POST"))
      ) {
        return jsonResponse(request, env, { error: "Demo tools disabled" }, 403);
      }

      // ── Public (unauthenticated) endpoints ──────────────────────────────
      // Everything else requires a valid staff session cookie. /auth/* routes
      // are listed as public because they manage their own session checks
      // internally (and magic-link/verify must be reachable while logged out).
      // /book/* is public — Turnstile, rate limits, and guest tokens protect writes.
      const isPublic =
        (path === "/leads/intake" && request.method === "POST") ||
        (path === "/admin/ingest-knowledge" && request.method === "POST") ||
        path.startsWith("/auth/") ||
        path.startsWith("/webhooks/") ||
        path.startsWith("/book/");

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

      if (serviceEnabled(env) && path.startsWith("/book/")) {
        const bookResponse = await handleBookRoutes(request, env, path);
        if (bookResponse) return bookResponse;
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

        if (path === "/service/day" && request.method === "GET") {
          return handleGetServiceDay(request, env);
        }

        if (path === "/service/stats" && request.method === "GET") {
          return handleGetServiceStats(request, env);
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

        const contactMatch = path.match(
          /^\/service\/reservations\/([^/]+)\/contact$/
        );
        if (contactMatch && request.method === "GET") {
          return handleGetReservationContact(request, env, contactMatch[1]);
        }
        if (contactMatch && request.method === "POST") {
          return handlePostReservationContact(request, env, contactMatch[1]);
        }

        const guestProfileMatch = path.match(
          /^\/service\/reservations\/([^/]+)\/guest-profile$/
        );
        if (guestProfileMatch && request.method === "PATCH") {
          return handlePatchReservationGuestProfile(
            request,
            env,
            guestProfileMatch[1]
          );
        }

        if (path === "/service/guests/profile" && request.method === "GET") {
          return handleGetGuestProfileByEmail(request, env);
        }
        if (path === "/service/guests/erase" && request.method === "POST") {
          return handleEraseGuest(request, env);
        }
        if (path === "/service/guests/export" && request.method === "GET") {
          return handleExportGuest(request, env);
        }

        const guestContactMatch = path.match(/^\/service\/guests\/([^/]+)$/);
        if (guestContactMatch && request.method === "PATCH") {
          return handlePatchGuestProfile(request, env, guestContactMatch[1]);
        }

        if (path === "/service/waitlist" && request.method === "GET") {
          return handleListWaitlist(request, env);
        }
        if (path === "/service/waitlist" && request.method === "POST") {
          return handleCreateWaitlist(request, env);
        }

        const waitlistNotifyMatch = path.match(
          /^\/service\/waitlist\/([^/]+)\/notify$/
        );
        if (waitlistNotifyMatch && request.method === "POST") {
          return handleNotifyWaitlist(request, env, waitlistNotifyMatch[1]);
        }

        const waitlistConvertMatch = path.match(
          /^\/service\/waitlist\/([^/]+)\/convert$/
        );
        if (waitlistConvertMatch && request.method === "POST") {
          return handleConvertWaitlist(request, env, waitlistConvertMatch[1]);
        }

        const waitlistRemoveMatch = path.match(
          /^\/service\/waitlist\/([^/]+)\/remove$/
        );
        if (waitlistRemoveMatch && request.method === "POST") {
          return handleRemoveWaitlist(request, env, waitlistRemoveMatch[1]);
        }

        if (path === "/service/guest-threads" && request.method === "GET") {
          return handleListGuestThreads(request, env);
        }

        const guestThreadFlagMatch = path.match(
          /^\/service\/guest-threads\/([^/]+)\/flag$/
        );
        if (guestThreadFlagMatch && request.method === "POST") {
          return handleFlagGuestThread(request, env, guestThreadFlagMatch[1]);
        }

        const guestThreadMuteMatch = path.match(
          /^\/service\/guest-threads\/([^/]+)\/mute$/
        );
        if (guestThreadMuteMatch && request.method === "POST") {
          return handleMuteGuestThread(request, env, guestThreadMuteMatch[1]);
        }

        const guestThreadUnmuteMatch = path.match(
          /^\/service\/guest-threads\/([^/]+)\/unmute$/
        );
        if (guestThreadUnmuteMatch && request.method === "POST") {
          return handleUnmuteGuestThread(request, env, guestThreadUnmuteMatch[1]);
        }

        const guestThreadMatch = path.match(/^\/service\/guest-threads\/([^/]+)$/);
        if (guestThreadMatch && request.method === "GET") {
          return handleGetGuestThread(request, env, guestThreadMatch[1]);
        }

        const reservationMatch = path.match(/^\/service\/reservations\/([^/]+)$/);
        if (reservationMatch && request.method === "GET") {
          return handleGetReservation(request, env, reservationMatch[1]);
        }
        if (reservationMatch && request.method === "PATCH") {
          return handlePatchReservation(request, env, reservationMatch[1]);
        }
      }

      // ── Kitchen plugin (flag off → falls through to 404) ─────────────────
      if (kitchenEnabled(env) && path.startsWith("/kitchen/")) {
        if (path === "/kitchen/menu" && request.method === "GET") {
          return handleGetKitchenMenu(request, env);
        }
        if (path === "/kitchen/menu/parse-image" && request.method === "POST") {
          return handleParseMenuImage(request, env);
        }
        if (path === "/kitchen/menu/import" && request.method === "POST") {
          return handleImportKitchenMenu(request, env);
        }
        if (path === "/kitchen/menu/reorder" && request.method === "PUT") {
          return handleReorderKitchenMenu(request, env);
        }
        if (path === "/kitchen/menu/categories" && request.method === "POST") {
          return handleCreateMenuCategory(request, env);
        }
        if (path === "/kitchen/menu/items" && request.method === "POST") {
          return handleCreateMenuItem(request, env);
        }
        const menuItemAvailMatch = path.match(
          /^\/kitchen\/menu\/items\/([^/]+)\/availability$/
        );
        if (menuItemAvailMatch && request.method === "PATCH") {
          return handleMenuItemAvailability(
            request,
            env,
            menuItemAvailMatch[1]
          );
        }
        const menuItemMatch = path.match(/^\/kitchen\/menu\/items\/([^/]+)$/);
        if (menuItemMatch && request.method === "DELETE") {
          return handleDeleteMenuItem(request, env, menuItemMatch[1]);
        }

        if (path === "/kitchen/orders" && request.method === "POST") {
          return handleCreateKitchenOrder(request, env);
        }

        if (path === "/kitchen/tickets" && request.method === "GET") {
          return handleListKitchenTickets(request, env);
        }

        if (path === "/kitchen/tickets" && request.method === "POST") {
          return handleCreateKitchenTicket(request, env);
        }

        const ticketStatusMatch = path.match(/^\/kitchen\/tickets\/([^/]+)\/status$/);
        if (ticketStatusMatch && request.method === "POST") {
          return handleKitchenTicketStatus(request, env, ticketStatusMatch[1]);
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

      if (path === "/webhooks/resend" && request.method === "POST") {
        return handleResendWebhook(request, env);
      }

      if (path === "/webhooks/stripe" && request.method === "POST") {
        return handleStripeWebhook(request, env);
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

  async scheduled(
    _controller: ScheduledController,
    env: Env,
    _ctx: ExecutionContext
  ): Promise<void> {
    try {
      await verifySchemaVersion(env);
    } catch (e) {
      console.error("[cron] schema check failed", String(e));
      return;
    }
    await runScheduledJobs(env);
  },
};
