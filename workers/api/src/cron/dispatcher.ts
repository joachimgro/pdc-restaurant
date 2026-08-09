import type { Env } from "../env";
import { sweepExpiredHolds } from "../plugins/service/holds";
import { dispatchDueNotifications } from "../notifications/dispatch";
import { scheduleDueReviewRequests } from "../notifications/review-requests";
import { expirePendingPayments } from "../plugins/service/db/payments";
import { depositsEnabled } from "../capabilities";
import { recordCronHeartbeat } from "./heartbeat";

/**
 * Cron dispatcher — order matches master spec §11.
 * Each step is try/caught so one failure does not block the rest.
 */
export async function runScheduledJobs(env: Env): Promise<void> {
  await runStep("sweepExpiredHolds", () => sweepExpiredHolds(env));
  await runStep("expirePendingPayments", async () => {
    if (!depositsEnabled(env)) return;
    return expirePendingPayments(env);
  });
  await runStep("scheduleDueReviewRequests", () =>
    scheduleDueReviewRequests(env)
  );
  await runStep("dispatchDueNotifications", () =>
    dispatchDueNotifications(env, { limit: 50 })
  );
  await runStep("expireWaitlistNotifications", async () => {
    // Phase 7 — no-op stub until waitlist expire lands on this fork
  });
  await runStep("markNoShows", async () => {
    // Optional — skipped until console needs it
  });
  await runStep("cronHeartbeat", () => recordCronHeartbeat(env));
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
