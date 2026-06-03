import type { Env } from "../env";

function trim(value: string | undefined): string | undefined {
  const v = value?.trim();
  return v || undefined;
}

export interface ResolvedTwilioCreds {
  accountSid: string;
  /** Basic-auth username (Account SID or API Key SID) */
  authUser: string;
  /** Basic-auth password (Auth Token or API Key Secret) */
  authPass: string;
  messagingServiceSid?: string;
  fromNumber?: string;
}

export function resolveTwilioCreds(env: Env): ResolvedTwilioCreds | null {
  const accountSid = trim(env.TWILIO_ACCOUNT_SID);
  const authToken = trim(env.TWILIO_AUTH_TOKEN);
  const apiKeySid = trim(env.TWILIO_API_KEY_SID);
  const apiKeySecret = trim(env.TWILIO_API_KEY_SECRET);
  const messagingServiceSid = trim(env.TWILIO_MESSAGING_SERVICE_SID);
  const fromNumber = trim(env.TWILIO_FROM_NUMBER);

  if (!accountSid || (!messagingServiceSid && !fromNumber)) return null;

  if (!accountSid.startsWith("AC")) {
    return null;
  }

  if (apiKeySid?.startsWith("SK") && apiKeySecret) {
    return {
      accountSid,
      authUser: apiKeySid,
      authPass: apiKeySecret,
      messagingServiceSid,
      fromNumber,
    };
  }

  if (authToken) {
    return {
      accountSid,
      authUser: accountSid,
      authPass: authToken,
      messagingServiceSid,
      fromNumber,
    };
  }

  return null;
}

export function twilioConfigured(env: Env): boolean {
  if (trim(env.TWILIO_SEND_OUTBOUND) === "false") return false;
  return resolveTwilioCreds(env) !== null;
}

/** Safe metadata so you can compare with Twilio Console (no secrets exposed). */
export function twilioSecretDiagnostics(env: Env): {
  accountSidMask: string | null;
  authTokenLength: number;
  authMode: "auth_token" | "api_key" | "none";
  messagingServiceMask: string | null;
} {
  const accountSid = trim(env.TWILIO_ACCOUNT_SID);
  const authToken = trim(env.TWILIO_AUTH_TOKEN);
  const apiKeySid = trim(env.TWILIO_API_KEY_SID);
  const apiKeySecret = trim(env.TWILIO_API_KEY_SECRET);
  const mg = trim(env.TWILIO_MESSAGING_SERVICE_SID);

  const mask = (s: string) =>
    s.length >= 10 ? `${s.slice(0, 6)}…${s.slice(-4)}` : null;

  let authMode: "auth_token" | "api_key" | "none" = "none";
  if (apiKeySid?.startsWith("SK") && apiKeySecret) authMode = "api_key";
  else if (authToken) authMode = "auth_token";

  return {
    accountSidMask: accountSid ? mask(accountSid) : null,
    authTokenLength: authToken?.length ?? 0,
    authMode,
    messagingServiceMask: mg ? mask(mg) : null,
  };
}

export function twilioCredentialHints(env: Env): string[] {
  const hints: string[] = [];
  const accountSid = trim(env.TWILIO_ACCOUNT_SID);
  const authToken = trim(env.TWILIO_AUTH_TOKEN);
  const apiKeySid = trim(env.TWILIO_API_KEY_SID);
  const apiKeySecret = trim(env.TWILIO_API_KEY_SECRET);
  const mg = trim(env.TWILIO_MESSAGING_SERVICE_SID);

  if (!accountSid) hints.push("TWILIO_ACCOUNT_SID is missing.");
  else if (accountSid.startsWith("SK"))
    hints.push(
      "TWILIO_ACCOUNT_SID looks like an API Key (SK…). Use your Account SID (AC…) from the Twilio Console home page."
    );
  else if (!accountSid.startsWith("AC"))
    hints.push("TWILIO_ACCOUNT_SID should start with AC.");

  if (!authToken && !(apiKeySid && apiKeySecret))
    hints.push(
      "Set TWILIO_AUTH_TOKEN (primary token), or TWILIO_API_KEY_SID + TWILIO_API_KEY_SECRET."
    );

  if (authToken && authToken.startsWith("SK"))
    hints.push(
      "TWILIO_AUTH_TOKEN looks like an API Key SID. Use the Auth Token string, not an SK… value."
    );

  if (!mg && !trim(env.TWILIO_FROM_NUMBER))
    hints.push("Set TWILIO_MESSAGING_SERVICE_SID (MG…) or TWILIO_FROM_NUMBER.");

  if (mg && !mg.startsWith("MG"))
    hints.push("TWILIO_MESSAGING_SERVICE_SID should start with MG.");

  if (trim(env.TWILIO_SEND_OUTBOUND) === "false")
    hints.push("TWILIO_SEND_OUTBOUND=false — outbound SMS is disabled.");

  return hints;
}

function basicAuthHeader(user: string, pass: string): string {
  const raw = `${user}:${pass}`;
  const bytes = new TextEncoder().encode(raw);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return `Basic ${btoa(binary)}`;
}

export type TwilioVerifyResult =
  | { ok: true; accountSid: string; friendlyName: string }
  | {
      ok: false;
      status: number;
      code?: number;
      message?: string;
      hints: string[];
    };

/** Calls Twilio Accounts API to verify SID + credentials (no SMS sent). */
export async function verifyTwilioCredentials(
  env: Env
): Promise<TwilioVerifyResult> {
  const hints = twilioCredentialHints(env);
  const creds = resolveTwilioCreds(env);
  if (!creds) {
    return {
      ok: false,
      status: 0,
      message: "Twilio not configured",
      hints,
    };
  }

  const url = `https://api.twilio.com/2010-04-01/Accounts/${creds.accountSid}.json`;
  const res = await fetch(url, {
    headers: { Authorization: basicAuthHeader(creds.authUser, creds.authPass) },
  });

  const data = (await res.json()) as {
    friendly_name?: string;
    sid?: string;
    message?: string;
    code?: number;
  };

  if (!res.ok) {
    const authHints = [...hints];
    if (res.status === 401 || data.code === 20003) {
      authHints.push(
        "Twilio returned 401 Authenticate — Account SID and Auth Token do not match. In Console → Account, copy Account SID (AC…) and create/copy the primary Auth Token (not an API Key unless you set TWILIO_API_KEY_SID + TWILIO_API_KEY_SECRET).",
        "Re-apply: cd workers/api && wrangler secret put TWILIO_ACCOUNT_SID && wrangler secret put TWILIO_AUTH_TOKEN",
        "Secrets must be on the Worker (wrangler secret), not in apps/web/.env.local or the repo root .env."
      );
    }
    return {
      ok: false,
      status: res.status,
      code: data.code,
      message: data.message,
      hints: authHints,
    };
  }

  return {
    ok: true,
    accountSid: data.sid ?? creds.accountSid,
    friendlyName: data.friendly_name ?? "",
  };
}

export { basicAuthHeader };
