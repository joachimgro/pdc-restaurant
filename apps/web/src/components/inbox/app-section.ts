export type AppSection = "inbox" | "settings" | "knowledge";

export type SettingsArea = "locations" | "team" | "demo";

export function parseAppSection(value: string | null): AppSection | null {
  if (value === "admin") return "settings";
  if (value === "inbox" || value === "settings" || value === "knowledge") {
    return value;
  }
  return null;
}

export function parseSettingsArea(
  value: string | null
): SettingsArea | undefined {
  if (value === "locations" || value === "team" || value === "demo") {
    return value;
  }
  if (value === "admin") return "demo";
  return undefined;
}
