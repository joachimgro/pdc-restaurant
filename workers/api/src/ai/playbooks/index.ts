import { getGenericServicePlaybook } from "./generic-service";
import { getMartialArtsPlaybook } from "./martial-arts";
import { getMusicSchoolPlaybook } from "./music-school";
import { getPlatformPlaybook } from "./platform";
import { getTuitionCentrePlaybook } from "./tuition-centre";

export { getPlatformPlaybook };

export const DEFAULT_PRESET_ID = "generic-service";

export function resolvePresetId(presetId: string | null | undefined): string {
  const id = presetId?.trim();
  return id || DEFAULT_PRESET_ID;
}

export function getVerticalPlaybook(
  presetId: string | null | undefined,
  opts: { schedulingEnabled: boolean }
): string {
  const id = resolvePresetId(presetId);
  switch (id) {
    case "tuition-centre":
      return getTuitionCentrePlaybook(opts.schedulingEnabled);
    case "martial-arts":
      return getMartialArtsPlaybook(opts.schedulingEnabled);
    case "music-school":
      return getMusicSchoolPlaybook(opts.schedulingEnabled);
    case "generic-service":
    default:
      return getGenericServicePlaybook(opts.schedulingEnabled);
  }
}
