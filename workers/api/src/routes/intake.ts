import { IntakeFormSchema } from "@lead-intake/shared-types";
import { jsonResponse } from "../cors";
import { createInboundFromIntake } from "../db/intake";
import type { Env } from "../env";

export async function handleIntakeSubmit(
  request: Request,
  env: Env
): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse(request, env, { error: "Invalid JSON" }, 400);
  }

  const parsed = IntakeFormSchema.safeParse(body);
  if (!parsed.success) {
    return jsonResponse(
      request,
      env,
      { error: "Validation failed", issues: parsed.error.flatten() },
      400
    );
  }

  let leadId: string;
  let isNew: boolean;
  try {
    ({ leadId, isNew } = await createInboundFromIntake(env, parsed.data));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Intake failed";
    return jsonResponse(request, env, { error: msg }, 400);
  }

  await env.AI_QUEUE.send({
    type: "process_inbound",
    leadId,
    messageId: "intake",
  });

  return jsonResponse(request, env, {
    ok: true,
    leadId,
    isNew,
    queued: true,
    message: isNew
      ? "Thanks — we'll text you shortly with a welcome message."
      : "Thanks — we've updated your details and will text you shortly.",
  });
}
