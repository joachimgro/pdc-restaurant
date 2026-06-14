import { jsonResponse } from "../cors";
import { getCapabilities } from "../capabilities";
import type { Env } from "../env";

export async function handleCapabilities(
  request: Request,
  env: Env
): Promise<Response> {
  return jsonResponse(request, env, getCapabilities(env));
}
