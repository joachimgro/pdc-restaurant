"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { StaffUser } from "@lead-intake/shared-types";
import { logoutAuth } from "@/lib/api/client";
import { fetchCapabilities, type Capabilities } from "@/lib/api/capabilities";
import { getPlugins } from "@/plugins/registry";
import type { AppSection } from "./app-section";
import { IconBook, IconInbox, IconSearch, IconSettings } from "./icons";

function pluginVisible(pluginId: string, caps: Capabilities | null): boolean {
  if (pluginId === "kitchen") return caps?.kitchen === true;
  if (pluginId === "stats") {
    return caps?.service === true || caps?.reservations === true;
  }
  return true;
}

export function NavRail({
  staffUser,
  activeSection,
  onSectionChange,
}: {
  staffUser: StaffUser | null;
  activeSection: AppSection;
  onSectionChange: (section: AppSection) => void;
}) {
  const router = useRouter();
  const [caps, setCaps] = useState<Capabilities | null>(null);
  const allPlugins = getPlugins().filter((p) => pluginVisible(p.id, caps));
  const topPlugins = allPlugins.filter((p) => p.railPosition === "top");
  const bottomPlugins = allPlugins.filter((p) => p.railPosition === "bottom");

  useEffect(() => {
    void fetchCapabilities().then(setCaps);
  }, []);

  async function handleLogout() {
    await logoutAuth();
    router.replace("/login");
  }

  return (
    <aside className="rail">
      <div className="rail-logo">L</div>
      <div className="rail-divider" />
      <button
        type="button"
        className={`rail-icon ${activeSection === "inbox" ? "active" : ""}`}
        title="Inbox"
        onClick={() => onSectionChange("inbox")}
      >
        <IconInbox />
      </button>
      {/* Plugin nav items — top position */}
      {topPlugins.map((plugin) => {
        const Icon = plugin.Icon;
        return (
          <button
            key={plugin.id}
            type="button"
            className={`rail-icon ${activeSection === plugin.id ? "active" : ""}`}
            title={plugin.label}
            onClick={() => onSectionChange(plugin.id)}
          >
            <Icon />
          </button>
        );
      })}
      <div className="rail-bottom">
        {staffUser && (
          <button
            type="button"
            className="rail-staff-btn"
            title={`Signed in as ${staffUser.name}`}
            onClick={() => void handleLogout()}
          >
            {staffUser.name
              .split(" ")
              .map((p) => p[0])
              .join("")
              .slice(0, 2)
              .toUpperCase()}
          </button>
        )}
        <div className="rail-icon" title="Search (coming soon)">
          <IconSearch />
        </div>
        <button
          type="button"
          className={`rail-icon ${activeSection === "knowledge" ? "active" : ""}`}
          title="AI knowledge"
          onClick={() => onSectionChange("knowledge")}
        >
          <IconBook />
        </button>
        {/* Plugin nav items — bottom position */}
        {bottomPlugins.map((plugin) => {
          const Icon = plugin.Icon;
          return (
            <button
              key={plugin.id}
              type="button"
              className={`rail-icon ${activeSection === plugin.id ? "active" : ""}`}
              title={plugin.label}
              onClick={() => onSectionChange(plugin.id)}
            >
              <Icon />
            </button>
          );
        })}
        <button
          type="button"
          className={`rail-icon ${activeSection === "settings" ? "active" : ""}`}
          title="Settings"
          onClick={() => onSectionChange("settings")}
        >
          <IconSettings />
        </button>
      </div>
    </aside>
  );
}
