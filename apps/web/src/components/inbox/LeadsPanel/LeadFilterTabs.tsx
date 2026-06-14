"use client";

import type { LeadFilterTab } from "@/lib/lead-filters";
import { LEAD_FILTER_TABS } from "@/lib/lead-filters";

export function LeadFilterTabs({
  active,
  onChange,
}: {
  active: LeadFilterTab;
  onChange: (tab: LeadFilterTab) => void;
}) {
  return (
    <div className="filter-tabs" role="tablist" aria-label="Filter leads">
      {LEAD_FILTER_TABS.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={active === tab.id}
          className={`filter-tab ${active === tab.id ? "active" : ""}`}
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
