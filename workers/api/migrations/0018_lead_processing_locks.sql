-- Phase 3 Fix 1: per-lead processing lock.
-- Serialises AI processing per lead so two queue messages for the same lead
-- (e.g. SMS + Instagram, or two quick texts) cannot both run the pipeline and
-- send two replies. Channel-agnostic: keyed on lead_id, not on any provider.
--
-- expires_at gives a TTL so a consumer that crashes mid-pipeline does not leave
-- the lead permanently locked. The acquire query overwrites only expired locks.

CREATE TABLE IF NOT EXISTS lead_processing_locks (
  lead_id                     TEXT PRIMARY KEY,
  locked_at                   TEXT NOT NULL,
  locked_by_queue_message_id  TEXT NOT NULL,
  expires_at                  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_lead_locks_expires ON lead_processing_locks(expires_at);
