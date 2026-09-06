"use client";

import { StatsView } from "@/plugins/service/console/StatsView";
import { TicketHistory } from "./TicketHistory";
import "@/plugins/service/console/console.css";
import "./stats.css";

/**
 * Full-rail Stats workspace — separate from the Service console so managers
 * can open analytics without leaving the floor flow buried in a tab.
 */
export function StatsWorkspace() {
  return (
    <div className="st-root" style={{ gridColumn: "2 / -1" }}>
      <div className="st-panel">
        <StatsView />
        <TicketHistory />
      </div>
    </div>
  );
}
