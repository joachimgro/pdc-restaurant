import type { TrialProposal } from "@lead-intake/shared-types";
import { confirmTrial } from "./trial-booking";

/** Legacy alias — use confirmTrial with a full proposal. */
export async function saveLeadTrialSlot(
  env: import("../env").Env,
  leadId: string,
  slot: { id: string; label: string }
): Promise<void> {
  const proposal: TrialProposal = {
    slotId: slot.id,
    day: "",
    label: slot.label,
    displayLabel: slot.label,
  };
  await confirmTrial(env, leadId, proposal);
}
