"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { StaffUser } from "@lead-intake/shared-types";
import { logoutAuth } from "@/lib/api/client";
import { IconBook, IconSearch, IconSettings } from "./icons";
import { AdminPanel } from "./AdminPanel";
import { KnowledgePanel } from "./KnowledgePanel";

const LOCATIONS = [
  { id: "manchester", abbrev: "M", badge: 7 },
  { id: "leeds", abbrev: "L", badge: 3 },
  { id: "bolton", abbrev: "B", badge: null },
  { id: "stockport", abbrev: "S", badge: 1 },
];

export function LocationRail({ staffUser }: { staffUser: StaffUser | null }) {
  const router = useRouter();
  const [active, setActive] = useState("manchester");
  const [adminOpen, setAdminOpen] = useState(false);
  const [knowledgeOpen, setKnowledgeOpen] = useState(false);

  async function handleLogout() {
    await logoutAuth();
    router.replace("/login");
  }

  return (
    <>
      <aside className="rail">
        <div className="rail-logo">M</div>
        <div className="rail-divider" />
        {LOCATIONS.map((loc) => (
          <button
            key={loc.id}
            type="button"
            className={`location-pill ${active === loc.id ? "active" : ""}`}
            title={loc.id}
            onClick={() => setActive(loc.id)}
          >
            {loc.abbrev}
            {loc.badge != null && <span className="count">{loc.badge}</span>}
          </button>
        ))}
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
          <div className="rail-icon" title="Search">
            <IconSearch />
          </div>
          <button
            type="button"
            className={`rail-icon ${knowledgeOpen ? "active" : ""}`}
            title="AI knowledge"
            onClick={() => setKnowledgeOpen(true)}
          >
            <IconBook />
          </button>
          <Link
            href="/settings"
            className="rail-icon"
            title="Locations & schedules"
          >
            <IconSettings />
          </Link>
          <button
            type="button"
            className={`rail-icon ${adminOpen ? "active" : ""}`}
            title="Admin tools"
            onClick={() => setAdminOpen(true)}
          >
            <span style={{ fontSize: 10, fontWeight: 700 }}>A</span>
          </button>
        </div>
      </aside>
      <KnowledgePanel
        open={knowledgeOpen}
        onClose={() => setKnowledgeOpen(false)}
      />
      <AdminPanel
        open={adminOpen}
        onClose={() => setAdminOpen(false)}
        staffUser={staffUser}
      />
    </>
  );
}
