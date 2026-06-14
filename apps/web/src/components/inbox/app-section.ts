import { isPluginSection } from "@/plugins/registry";

/** Core sections — always present, never removed */
export type CoreSection = "inbox" | "settings" | "knowledge";

/** Any section — core or plugin */
export type AppSection = CoreSection | (string & {});
// The `string & {}` trick: allows any string at runtime while keeping
// CoreSection values autocompleted in the editor. No breaking change.

export type SettingsArea = "locations" | "team" | "demo" | "ai";

export function parseAppSection(value: string | null): AppSection | null {
  if (!value) return null;
  if (value === "admin") return "settings";
  // Core sections
  if (value === "inbox" || value === "settings" || value === "knowledge") {
    return value;
  }
  // Plugin sections — valid if registered
  if (isPluginSection(value)) {
    return value;
  }
  return null;
}

export function parseSettingsArea(
  value: string | null
): SettingsArea | undefined {
  if (value === "locations" || value === "team" || value === "demo" || value === "ai") {
    return value;
  }
  if (value === "admin") return "demo";
  return undefined;
}
