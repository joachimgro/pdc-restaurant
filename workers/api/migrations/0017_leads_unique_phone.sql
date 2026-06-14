-- Phase 2 Fix 1: unique (organization_id, phone) per org.
-- Deduplicates first (keeps oldest lead), then adds the constraint.
-- Safe pre-launch; post-launch would need manual review of any duplicates.

DELETE FROM leads
WHERE id NOT IN (
  SELECT id FROM (
    SELECT id, ROW_NUMBER() OVER (
      PARTITION BY organization_id, phone
      ORDER BY created_at ASC
    ) AS rn
    FROM leads
  ) WHERE rn = 1
);

CREATE UNIQUE INDEX idx_leads_org_phone ON leads(organization_id, phone);
