export interface Env {
  DB: D1Database;
  AI_QUEUE: Queue<QueueMessage>;
  AI?: Ai;
  KNOWLEDGE?: VectorizeIndex;
  ORGANIZATION_ID: string;
  CORS_ORIGIN: string;
  /** Set to "true" to enable /admin/seed and /leads/simulate (demo/dev only) */
  ENABLE_DEMO_TOOLS?: string;
  /** Set to "true" to enable slot booking + Schedule settings UI */
  ENABLE_SIMPLE_SCHEDULING?: string;
  /** Set to "true" to enable multi-venue + location in qualification */
  ENABLE_MULTI_LOCATION?: string;
  /** Set to "true" to enable the service module (/service/* routes + nav) */
  ENABLE_SERVICE?: string;
  /** Set to "true" to enable the booking flow and reservation routes */
  ENABLE_RESERVATIONS?: string;
  /** Set to "true" to enable waitlist UI and routes */
  ENABLE_WAITLIST?: string;
  /** Set to "true" to enable Stripe deposit/card-on-file paths */
  ENABLE_DEPOSITS?: string;
  /** Set to "true" to enable floor plan views (off = list/timeline only) */
  ENABLE_FLOOR_PLAN?: string;
  /** Set to "true" to auto-assign tables (off = bookings land unassigned) */
  ENABLE_AUTO_ASSIGN?: string;
  /** Set to "true" to use template stub instead of Workers AI */
  AI_DISABLED?: string;
  AI_EMBED_MODEL?: string;
  TELNYX_API_KEY?: string;
  /**
   * Telnyx webhook signing public key (base64-encoded Ed25519 public key).
   * Find in Telnyx portal → Messaging → Webhooks → your endpoint → Public Key.
   * Set with: wrangler secret put TELNYX_WEBHOOK_PUBLIC_KEY
   */
  TELNYX_WEBHOOK_PUBLIC_KEY?: string;
  TWILIO_ACCOUNT_SID?: string;
  TWILIO_AUTH_TOKEN?: string;
  TWILIO_API_KEY_SID?: string;
  TWILIO_API_KEY_SECRET?: string;
  TWILIO_MESSAGING_SERVICE_SID?: string;
  TWILIO_FROM_NUMBER?: string;
  /** Set to "false" to skip outbound SMS (inbox-only demo) */
  TWILIO_SEND_OUTBOUND?: string;
  /** Set to "true" only for local testing without signature */
  TWILIO_SKIP_SIGNATURE_VALIDATION?: string;
  ADMIN_SEED_SECRET?: string;
  RESEND_API_KEY?: string;
  AUTH_FROM_EMAIL?: string;
  /** Web app origin for post-login redirect (defaults to first CORS_ORIGIN) */
  AUTH_WEB_ORIGIN?: string;
  /** Optional KV namespace for per-org AI rate limiting (Phase 4) */
  RATE_LIMITS?: KVNamespace;
}

export type QueueMessage =
  | { type: "process_inbound"; leadId: string; messageId: string }
  | { type: "simulate_ai_reply"; leadId: string };
