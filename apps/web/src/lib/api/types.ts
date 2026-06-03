import type { DomainEvent, GroupedLeads, Lead } from "@lead-intake/shared-types";

export interface LeadsRepository {
  listLeads(): Promise<GroupedLeads>;
  getLead(id: string): Promise<Lead | null>;
  selectLead(id: string): Promise<Lead>;
  simulateNewLead(): Promise<void>;
  takeoverLead(id: string): Promise<Lead>;
  subscribe(cb: (event: DomainEvent) => void): () => void;
  ensureSeeded(): Promise<void>;
}
