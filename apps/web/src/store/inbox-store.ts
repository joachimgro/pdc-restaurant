"use client";

import { create } from "zustand";
import type { DomainEvent, GroupedLeads, Lead } from "@lead-intake/shared-types";
import {
  resetAllLeads,
  restoreDemoSeed as apiRestoreDemoSeed,
} from "@/lib/api/admin";
import {
  deleteLead as apiDeleteLead,
  fetchLeadOrNull,
  fetchLeads,
  seedApi,
  selectLeadOrNull,
  simulateNewLead,
  subscribeEvents,
  resumeAiLead,
  addLeadNote as apiAddLeadNote,
  sendStaffMessage as apiSendStaffMessage,
  takeoverLead,
} from "@/lib/api/client";

function countLeadsInGroups(groups: GroupedLeads["groups"]): number {
  return (
    groups.today.length + groups.yesterday.length + groups.thisWeek.length
  );
}

function pruneLead(
  state: Pick<
    InboxState,
    "leads" | "groups" | "activeLeadId" | "activeCount" | "typingLeadId"
  >,
  id: string
): Pick<
  InboxState,
  "leads" | "groups" | "activeLeadId" | "activeCount" | "typingLeadId"
> {
  const hadLead = Boolean(state.leads[id]);
  const { [id]: _removed, ...leads } = state.leads;
  const filter = (arr: string[]) => arr.filter((k) => k !== id);
  const groups = {
    today: filter(state.groups.today),
    yesterday: filter(state.groups.yesterday),
    thisWeek: filter(state.groups.thisWeek),
  };
  const remaining = [
    ...groups.today,
    ...groups.yesterday,
    ...groups.thisWeek,
  ];
  return {
    leads,
    groups,
    activeLeadId:
      state.activeLeadId === id ? (remaining[0] ?? null) : state.activeLeadId,
    activeCount: hadLead
      ? Math.max(0, state.activeCount - 1)
      : state.activeCount,
    typingLeadId: state.typingLeadId === id ? null : state.typingLeadId,
  };
}

interface InboxState {
  loading: boolean;
  error: string | null;
  activeLeadId: string | null;
  activeCount: number;
  groups: GroupedLeads["groups"];
  leads: Record<string, Lead>;
  typingLeadId: string | null;
  sseCleanup: (() => void) | null;

  init: () => Promise<void>;
  reloadLeads: () => Promise<void>;
  selectLead: (id: string) => Promise<void>;
  simulateNewLead: () => Promise<void>;
  toggleAiControl: () => Promise<void>;
  sendStaffMessage: (text: string) => Promise<{ smsSent: boolean }>;
  addLeadNote: (body: string) => Promise<void>;
  deleteLead: (id: string) => Promise<void>;
  deleteAllLeads: () => Promise<{ message: string }>;
  restoreDemoSeed: () => Promise<{ seeded: boolean; count: number }>;
  applyEvent: (event: DomainEvent) => void;
  refreshLead: (id: string) => Promise<void>;
}

export const useInboxStore = create<InboxState>((set, get) => ({
  loading: true,
  error: null,
  activeLeadId: null,
  activeCount: 0,
  groups: { today: [], yesterday: [], thisWeek: [] },
  leads: {},
  typingLeadId: null,
  sseCleanup: null,

  reloadLeads: async () => {
    const list = await fetchLeads();
    const leads: Record<string, Lead> = {};
    const ids = [
      ...list.groups.today,
      ...list.groups.yesterday,
      ...list.groups.thisWeek,
    ];

    await Promise.all(
      ids.map(async (id) => {
        const lead = await fetchLeadOrNull(id);
        if (lead) leads[id] = lead;
      })
    );

    const loadedIds = new Set(Object.keys(leads));
    const filterGroup = (arr: string[]) =>
      arr.filter((id) => loadedIds.has(id));

    const groups = {
      today: filterGroup(list.groups.today),
      yesterday: filterGroup(list.groups.yesterday),
      thisWeek: filterGroup(list.groups.thisWeek),
    };
    const allIds = [
      ...groups.today,
      ...groups.yesterday,
      ...groups.thisWeek,
    ];

    const activeId = get().activeLeadId;
    const nextActive =
      activeId && loadedIds.has(activeId) ? activeId : (allIds[0] ?? null);

    set({
      activeCount: countLeadsInGroups(groups),
      groups,
      leads,
      activeLeadId: nextActive,
      typingLeadId: null,
    });
  },

  init: async () => {
    try {
      set({ loading: true, error: null });

      get().sseCleanup?.();

      await get().reloadLeads();

      if (countLeadsInGroups(get().groups) === 0) {
        await seedApi().catch(() => undefined);
        await get().reloadLeads();
      }

      // No cursor on full page load — API starts at latest event (no backlog replay).
      const cleanup = subscribeEvents((event) => get().applyEvent(event));
      set({ loading: false, sseCleanup: cleanup });
    } catch (e) {
      set({
        loading: false,
        error: e instanceof Error ? e.message : "Failed to load",
      });
    }
  },

  deleteLead: async (id: string) => {
    await apiDeleteLead(id);
    set((s) => pruneLead(s, id));
    await get().reloadLeads();
    const next = get().activeLeadId;
    if (next && get().leads[next]) {
      await get().selectLead(next);
    }
  },

  deleteAllLeads: async () => {
    const result = await resetAllLeads();
    set({
      activeLeadId: null,
      activeCount: 0,
      groups: { today: [], yesterday: [], thisWeek: [] },
      leads: {},
      typingLeadId: null,
    });
    return { message: result.message };
  },

  restoreDemoSeed: async () => {
    const result = await apiRestoreDemoSeed();
    await get().reloadLeads();
    return result;
  },

  selectLead: async (id: string) => {
    const lead = await selectLeadOrNull(id);
    if (!lead) {
      set((s) => pruneLead(s, id));
      return;
    }
    set((s) => ({
      activeLeadId: id,
      leads: { ...s.leads, [id]: lead },
    }));
  },

  simulateNewLead: async () => {
    if (get().leads.olivia) return;

    const { lead } = await simulateNewLead();

    set((s) => ({
      activeCount: s.activeCount + 1,
      groups: {
        ...s.groups,
        today: ["olivia", ...s.groups.today.filter((k) => k !== "olivia")],
      },
      leads: { ...s.leads, olivia: { ...lead, justArrived: true } },
    }));

    setTimeout(() => {
      void get().selectLead("olivia");
    }, 1500);

    setTimeout(() => {
      set((s) => {
        const o = s.leads.olivia;
        if (!o) return s;
        return {
          leads: { ...s.leads, olivia: { ...o, justArrived: false } },
        };
      });
    }, 3000);
  },

  toggleAiControl: async () => {
    const id = get().activeLeadId;
    if (!id) return;
    const current = get().leads[id];
    const lead = current?.aiPaused
      ? await resumeAiLead(id)
      : await takeoverLead(id);
    set((s) => ({
      leads: { ...s.leads, [id]: lead },
    }));
  },

  sendStaffMessage: async (text: string) => {
    const id = get().activeLeadId;
    if (!id) throw new Error("No active lead");
    const { lead, smsSent } = await apiSendStaffMessage(id, text);
    set((s) => ({ leads: { ...s.leads, [id]: lead } }));
    return { smsSent };
  },

  addLeadNote: async (body: string) => {
    const id = get().activeLeadId;
    if (!id) return;
    const lead = await apiAddLeadNote(id, body);
    set((s) => ({ leads: { ...s.leads, [id]: lead } }));
  },

  refreshLead: async (id: string) => {
    const lead = await fetchLeadOrNull(id);
    if (!lead) {
      set((s) => pruneLead(s, id));
      return;
    }
    set((s) => ({ leads: { ...s.leads, [id]: lead } }));
  },

  applyEvent: (event: DomainEvent) => {
    if (event.type === "typing.started") {
      set({ typingLeadId: event.payload.leadId });
      return;
    }
    if (event.type === "typing.stopped") {
      set({ typingLeadId: null });
      return;
    }

    if (event.type === "lead.created") {
      const { lead } = event.payload;
      set((s) => {
        if (s.leads[lead.id]) {
          return { leads: { ...s.leads, [lead.id]: lead } };
        }
        const groups = {
          ...s.groups,
          today: [lead.id, ...s.groups.today.filter((k) => k !== lead.id)],
        };
        return {
          activeCount: countLeadsInGroups(groups),
          groups,
          leads: { ...s.leads, [lead.id]: lead },
        };
      });
      return;
    }

    if (
      event.type === "lead.updated" ||
      event.type === "lead.ai_failed" ||
      event.type === "message.created"
    ) {
      void get().refreshLead(event.payload.leadId);
    }
  },
}));

export function useSelectedLead(): Lead | null {
  const id = useInboxStore((s) => s.activeLeadId);
  const leads = useInboxStore((s) => s.leads);
  return id ? leads[id] ?? null : null;
}
