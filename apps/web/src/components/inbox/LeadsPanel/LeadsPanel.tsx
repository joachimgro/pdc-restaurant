"use client";

import { useMemo, useState } from "react";
import {
  countLeadsMatchingFilter,
  filterCountLabel,
  matchesLeadFilter,
  type LeadFilterTab,
} from "@/lib/lead-filters";
import { useInboxStore } from "@/store/inbox-store";
import { IconPlus } from "../icons";
import { LeadFilterTabs } from "./LeadFilterTabs";
import { LeadRow } from "./LeadRow";

const GROUP_LABELS: Record<string, string> = {
  today: "Today",
  yesterday: "Yesterday",
  thisWeek: "This week",
};

const GROUP_KEYS = ["today", "yesterday", "thisWeek"] as const;

export function LeadsPanel() {
  const activeLeadId = useInboxStore((s) => s.activeLeadId);
  const groups = useInboxStore((s) => s.groups);
  const leads = useInboxStore((s) => s.leads);
  const selectLead = useInboxStore((s) => s.selectLead);
  const simulateNewLead = useInboxStore((s) => s.simulateNewLead);
  const [filterTab, setFilterTab] = useState<LeadFilterTab>("all");

  const filteredCount = useMemo(
    () => countLeadsMatchingFilter(leads, groups, filterTab),
    [leads, groups, filterTab]
  );

  const hasVisibleLeads = useMemo(() => {
    for (const groupKey of GROUP_KEYS) {
      for (const id of groups[groupKey]) {
        const lead = leads[id];
        if (lead && matchesLeadFilter(lead, filterTab, groupKey)) return true;
      }
    }
    return false;
  }, [leads, groups, filterTab]);

  return (
    <aside className="leads">
      <div className="leads-header">
        <div>
          <div className="leads-title">Leads</div>
          <div className="leads-count">
            {filterCountLabel(filterTab, filteredCount)}
          </div>
        </div>
        <button
          type="button"
          className="new-lead-btn"
          title="Simulate new lead (demo)"
          onClick={() => void simulateNewLead()}
        >
          <IconPlus />
        </button>
      </div>

      <LeadFilterTabs active={filterTab} onChange={setFilterTab} />

      <div className="leads-scroll">
        {!hasVisibleLeads ? (
          <div className="leads-empty-filter">No leads in this view</div>
        ) : (
          GROUP_KEYS.map((groupKey) => {
            const ids = groups[groupKey].filter((id) => {
              const lead = leads[id];
              return lead && matchesLeadFilter(lead, filterTab, groupKey);
            });
            if (!ids.length) return null;
            return (
              <div key={groupKey}>
                <div className="leads-group-label">{GROUP_LABELS[groupKey]}</div>
                {ids.map((id) => {
                  const lead = leads[id];
                  if (!lead) return null;
                  return (
                    <LeadRow
                      key={id}
                      lead={lead}
                      listGroup={groupKey}
                      active={id === activeLeadId}
                      onSelect={() => void selectLead(id)}
                    />
                  );
                })}
              </div>
            );
          })
        )}
      </div>
    </aside>
  );
}
