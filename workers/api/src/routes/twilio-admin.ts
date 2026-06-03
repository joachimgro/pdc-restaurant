import { jsonResponse } from "../cors";
import {
  twilioConfigured,
  twilioCredentialHints,
  twilioSecretDiagnostics,
  verifyTwilioCredentials,
} from "../twilio/credentials";
import type { Env } from "../env";

/** GET /admin/twilio-check — verify secrets without sending SMS */
export async function handleTwilioCheck(
  request: Request,
  env: Env
): Promise<Response> {
  const hints = twilioCredentialHints(env);
  const diagnostics = twilioSecretDiagnostics(env);
  const configured = twilioConfigured(env);

  if (!configured) {
    return jsonResponse(request, env, {
      ok: false,
      configured: false,
      diagnostics,
      hints,
    });
  }

  const result = await verifyTwilioCredentials(env);
  return jsonResponse(request, env, {
    configured: true,
    diagnostics,
    ...result,
  });
}
