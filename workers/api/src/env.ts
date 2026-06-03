export interface Env {
  DB: D1Database;
  AI_QUEUE: Queue<QueueMessage>;
  AI?: Ai;
  KNOWLEDGE?: VectorizeIndex;
  ORGANIZATION_ID: string;
  CORS_ORIGIN: string;
  /** Set to "true" to enable /admin/seed and /leads/simulate (demo/dev only — off by default) */
  ENABLE_DEMO_TOOLS?: string;
  /** Set to "true" to use template stub instead of Workers AI */
  AI_DISABLED?: string;
  /** Resend API key — set via: wrangler secret put RESEND_API_KEY */
  RESEND_API_KEY?: string;
  /** Verified sender address in Resend, e.g. noreply@yourdomain.com */
  RESEND_FROM_EMAIL?: string;
  /** Deployed Next.js app URL — used to build magic link URLs */
  APP_URL?: string;
  /** Email of the super admin — cannot be removed via API */
  SUPER_ADMIN_EMAIL?: string;
  AI_EMBED_MODEL?: string;
  TELNYX_API_KEY?: string;
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
}

export type QueueMessage =
  | { type: "process_inbound"; leadId: string; messageId: string }
  | { type: "simulate_ai_reply"; leadId: string };
