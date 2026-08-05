import type { Env } from "../env";
import { sweepExpiredHolds } from "../plugins/service/holds";
import { dispatchDueNotifications } from "../notifications/dispatch";

/**
 * Cron dispatcher — order matches master spec §11.
 * Each step is try/caught so one failure does not block the rest.
 */
export async function runScheduledJobs(env: Env): Promise<void> {
  await runStep("sweepExpiredHolds", () => sweepExpiredHolds(env));
  await runStep("expirePendingPayments", async () => {
    // Phase 8 — no-op stub
  });
  await runStep("dispatchDueNotifications", () =>
    dispatchDueNotifications(env, { limit: 50 })
  );
  await runStep("expireWaitlistNotifications", async () => {
    // Phase 7 — no-op stub
  });
  await runStep("markNoShows", async () => {
    // Optional light flag — skipped until console needs it
  });
}

async function runStep(name: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    const result = await fn();
    if (result !== undefined) {
      console.log(`[cron] ${name}`, result);
    }
  } catch (e) {
    console.error(`[cron] ${name} failed`, String(e));
  }
}
