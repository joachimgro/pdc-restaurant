"use client";

import { useRouter } from "next/navigation";
import type { StaffUser } from "@lead-intake/shared-types";
import { logoutAuth } from "@/lib/api/client";
import type { AppSection } from "./app-section";
import { IconBook, IconInbox, IconSearch, IconSettings } from "./icons";

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
