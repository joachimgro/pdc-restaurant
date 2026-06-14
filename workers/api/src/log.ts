/**
 * Structured logging helpers. Always include org context.
 * Use these instead of console.* on critical error paths.
 */

type LogLevel = "info" | "warn" | "error";

function log(
  level: LogLevel,
  env: { ORGANIZATION_ID?: string },
  message: string,
  meta?: Record<string, unknown>
) {
  const payload = {
    level,
    org: env.ORGANIZATION_ID || "unknown",
    msg: message,
    ts: new Date().toISOString(),
    ...(meta || {}),
  };
  const fn =
    level === "error"
      ? console.error
      : level === "warn"
        ? console.warn
        : console.log;
  fn(JSON.stringify(payload));
}

export const logger = {
  info: (
    env: { ORGANIZATION_ID?: string },
    message: string,
    meta?: Record<string, unknown>
  ) => log("info", env, message, meta),
  warn: (
    env: { ORGANIZATION_ID?: string },
    message: string,
    meta?: Record<string, unknown>
  ) => log("warn", env, message, meta),
  error: (
    env: { ORGANIZATION_ID?: string },
    message: string,
    meta?: Record<string, unknown>
  ) => log("error", env, message, meta),
};
