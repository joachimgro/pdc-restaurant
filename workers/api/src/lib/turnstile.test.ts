import { describe, expect, it, vi, afterEach } from "vitest";
import { verifyTurnstile } from "./turnstile";
import type { Env } from "../env";

function env(partial: Partial<Env>): Env {
  return partial as Env;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("verifyTurnstile", () => {
  it("allows missing secret when demo tools are on", async () => {
    const result = await verifyTurnstile(
      env({ ENABLE_DEMO_TOOLS: "true", TURNSTILE_SECRET_KEY: undefined }),
      null,
      null
    );
    expect(result).toEqual({ ok: true });
  });

  it("rejects missing secret when demo tools are off", async () => {
    const result = await verifyTurnstile(
      env({ ENABLE_DEMO_TOOLS: "false", TURNSTILE_SECRET_KEY: undefined }),
      null,
      null
    );
    expect(result).toMatchObject({ ok: false, code: "TURNSTILE_NOT_CONFIGURED" });
  });

  it("allows missing token when demo tools are on even if secret is set", async () => {
    const result = await verifyTurnstile(
      env({ ENABLE_DEMO_TOOLS: "true", TURNSTILE_SECRET_KEY: "secret" }),
      undefined,
      "1.2.3.4"
    );
    expect(result).toEqual({ ok: true });
  });

  it("requires a token when secret is set and demo tools are off", async () => {
    const result = await verifyTurnstile(
      env({ ENABLE_DEMO_TOOLS: "false", TURNSTILE_SECRET_KEY: "secret" }),
      "   ",
      null
    );
    expect(result).toMatchObject({ ok: false, code: "TURNSTILE_REQUIRED" });
  });

  it("verifies a submitted token even in demo mode", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({ success: false, "error-codes": ["invalid-input-response"] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await verifyTurnstile(
      env({ ENABLE_DEMO_TOOLS: "true", TURNSTILE_SECRET_KEY: "secret" }),
      "bad-token",
      "9.9.9.9"
    );
    expect(result).toMatchObject({ ok: false, code: "TURNSTILE_FAILED" });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("accepts a verified token", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({ success: true }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await verifyTurnstile(
      env({ ENABLE_DEMO_TOOLS: "false", TURNSTILE_SECRET_KEY: "secret" }),
      "good-token",
      null
    );
    expect(result).toEqual({ ok: true });
  });
});
