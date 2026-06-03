import type { DomainEvent, GroupedLeads, Lead } from "@lead-intake/shared-types";
import type { LeadsRepository } from "./types";
import {
  fetchLeadOrNull,
  fetchLeads,
  seedApi,
  selectLead,
  simulateNewLead,
  subscribeEvents,
  takeoverLead,
} from "./client";

export class WorkerLeadsRepository implements LeadsRepository {
  private eventCursor: string | null = null;
  private unsubscribe: (() => void) | null = null;

  async ensureSeeded(): Promise<void> {
    try {
      await seedApi();
    } catch {
      // already seeded or worker offline
    }
  }

  async listLeads(): Promise<GroupedLeads> {
    const list = await fetchLeads();
    const leads: Record<string, Lead> = {};
    for (const id of [
      ...list.groups.today,
      ...list.groups.yesterday,
      ...list.groups.thisWeek,
    ]) {
      const full = await fetchLeadOrNull(id);
      if (full) leads[id] = full;
    }
    return {
      activeCount: list.activeCount,
      groups: list.groups,
      leads,
    };
  }

  async getLead(id: string): Promise<Lead | null> {
    try {
      return await fetchLeadOrNull(id);
    } catch {
      return null;
    }
  }

  async selectLead(id: string): Promise<Lead> {
    return selectLead(id);
  }

  async simulateNewLead(): Promise<void> {
    await simulateNewLead();
  }

  async takeoverLead(id: string): Promise<Lead> {
    return takeoverLead(id);
  }

  subscribe(cb: (event: DomainEvent) => void): () => void {
    this.unsubscribe?.();
    this.unsubscribe = subscribeEvents((event) => {
      this.eventCursor = event.id;
      cb(event);
    }, this.eventCursor);
    return () => {
      this.unsubscribe?.();
      this.unsubscribe = null;
    };
  }
}

export const workerRepository = new WorkerLeadsRepository();
