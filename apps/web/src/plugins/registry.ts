import type { ReactNode } from "react";

/**
 * PDC Plugin Registry
 *
 * Plugins register themselves here by calling `registerPlugin()`.
 * The core nav and workspace rendering reads from this registry.
 *
 * Convention:
 * - Each plugin lives on a feature branch (e.g. feat/bookings)
 * - The plugin's entry point imports this file and calls registerPlugin()
 * - The plugin never edits NavRail.tsx, InboxPage.tsx, or app-section.ts
 *
 * Core sections (inbox, settings, knowledge) are NOT registered here —
 * they remain hardcoded in the core files. This registry is for plugins only.
 */

export interface PluginDefinition {
  /** Unique section identifier. Use kebab-case. e.g. "bookings" */
  id: string;
  /** Tooltip shown on the nav rail icon */
  label: string;
  /** Position on the rail relative to other plugins. Lower = higher up. */
  order: number;
  /** Where on the rail: "top" (below inbox) or "bottom" (above settings) */
  railPosition: "top" | "bottom";
  /** The nav icon — a React component returning an SVG */
  Icon: () => ReactNode;
  /** The workspace rendered when this section is active */
  Workspace: () => ReactNode;
}

const plugins: Map<string, PluginDefinition> = new Map();

export function registerPlugin(plugin: PluginDefinition): void {
  if (plugins.has(plugin.id)) {
    console.warn(
      `[PDC] Plugin "${plugin.id}" is already registered. Skipping duplicate.`
    );
    return;
  }
  plugins.set(plugin.id, plugin);
}

export function getPlugins(): PluginDefinition[] {
  return Array.from(plugins.values()).sort((a, b) => a.order - b.order);
}

export function getPlugin(id: string): PluginDefinition | undefined {
  return plugins.get(id);
}

export function isPluginSection(id: string): boolean {
  return plugins.has(id);
}
