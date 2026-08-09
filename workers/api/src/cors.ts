import type { Env } from "./env";

function resolveCorsOrigin(request: Request, env: Env): string {
  const allowed = (env.CORS_ORIGIN || "*")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (allowed.includes("*")) return "*";

  const origin = request.headers.get("Origin");
  if (origin && allowed.includes(origin)) return origin;

  return allowed[0] ?? "*";
}

export function corsHeaders(
  request: Request,
  env: Env,
  extra?: HeadersInit
): Headers {
  const h = new Headers(extra);
  h.set("Access-Control-Allow-Origin", resolveCorsOrigin(request, env));
  // PUT is required by the whole-payload service routes (floor plan, settings,
  // table assignment). It was missing until a browser client existed to send
  // one: the preflight still returns 204, so the failure surfaces only as the
  // real request being blocked.
  h.set(
    "Access-Control-Allow-Methods",
    "GET, POST, PUT, PATCH, DELETE, OPTIONS"
  );
  h.set(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, Last-Event-ID, Idempotency-Key, If-Match"
  );
  h.set("Access-Control-Allow-Credentials", "true");
  h.set("Access-Control-Max-Age", "86400");
  h.set("Vary", "Origin");
  return h;
}

export function jsonResponse(
  request: Request,
  env: Env,
  data: unknown,
  status = 200
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: corsHeaders(request, env, {
      "Content-Type": "application/json",
    }),
  });
}

export function optionsResponse(request: Request, env: Env): Response {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(request, env),
  });
}
