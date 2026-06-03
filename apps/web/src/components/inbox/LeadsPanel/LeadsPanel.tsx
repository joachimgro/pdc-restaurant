"use client";

import { useInboxStore } from "@/store/inbox-store";
import { IconPlus } from "../icons";
import { LeadRow } from "./LeadRow";

const GROUP_LABELS: Record<string, string> = {
  today: "Today",
  yesterday: "Yesterday",
  thisWeek: "This week",
};

export function LeadsPanel() {
  const activeLeadId = useInboxStore((s) => s.activeLeadId);
  const activeCount = useInboxStore((s) => s.activeCount);
  const groups = useInboxStore((s) => s.groups);
  const leads = useInboxStore((s) => s.leads);
  const selectLead = useInboxStore((s) => s.selectLead);
  const simulateNewLead = useInboxStore((s) => s.simulateNewLead);

  return (
    <aside className="leads">
      <div className="leads-header">
        <div>
          <div className="leads-title">Leads</div>
          <div className="leads-count">{activeCount} active</div>
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

      <div className="leads-scroll">
      {(Object.keys(GROUP_LABELS) as Array<keyof typeof groups>).map(
        (groupKey) => {
          const ids = groups[groupKey];
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
                    active={id === activeLeadId}
                    onSelect={() => void selectLead(id)}
                  />
                );
              })}
            </div>
          );
        }
      )}
      </div>
    </aside>
  );
}
