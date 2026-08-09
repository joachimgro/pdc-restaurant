import { describe, expect, it } from "vitest";
import { corsHeaders, optionsResponse } from "./cors";
import type { Env } from "./env";

function env(partial: Partial<Env> = {}): Env {
  return {
    CORS_ORIGIN: "http://localhost:3000,https://kitchen.phiof.digital",
    ...partial,
  } as Env;
}

describe("corsHeaders", () => {
  it("echoes an allowed origin", () => {
    const req = new Request("https://api.example/book/x/reserve", {
      headers: { Origin: "http://localhost:3000" },
    });
    const headers = corsHeaders(req, env());
    expect(headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:3000");
    expect(headers.get("Access-Control-Allow-Credentials")).toBe("true");
  });

  it("allows Idempotency-Key and If-Match on preflight", () => {
    const req = new Request("https://api.example/book/x/reserve", {
      method: "OPTIONS",
      headers: {
        Origin: "http://localhost:3000",
        "Access-Control-Request-Headers": "content-type,idempotency-key",
      },
    });
    const res = optionsResponse(req, env());
    const allowed = res.headers.get("Access-Control-Allow-Headers") ?? "";
    expect(allowed.toLowerCase()).toContain("idempotency-key");
    expect(allowed.toLowerCase()).toContain("if-match");
    expect(allowed.toLowerCase()).toContain("content-type");
  });
});
