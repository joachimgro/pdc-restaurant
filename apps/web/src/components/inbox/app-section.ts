import { isPluginSection } from "@/plugins/registry";
import { consoleViewFromParam, isConsoleView } from "@/plugins/service/console-view";

/** Core sections — always present, never removed */
export type CoreSection = "inbox" | "settings" | "knowledge";

/** Any section — core or plugin */
export type AppSection = CoreSection | (string & {});

export type SettingsArea = "locations" | "team" | "demo" | "ai";

export function parseAppSection(value: string | null): AppSection | null {
  if (!value) return null;
  if (value === "admin") return "settings";
  // Service console deep links (?view=calendar, ?view=waitlist, …)
  // Stats is its own rail plugin — not a Service tab.
  if (value === "stats") return "stats";
  if (value === "service" || isConsoleView(value)) {
    return "service";
  }
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

export { consoleViewFromParam, isConsoleView };

export function parseSettingsArea(
  value: string | null
): SettingsArea | undefined {
  if (value === "locations" || value === "team" || value === "demo" || value === "ai") {
    return value;
  }
  if (value === "admin") return "demo";
  return undefined;
}
