-- Send-lock table: prevents duplicate outbound SMS on queue consumer retries.
-- Before calling the SMS provider the consumer sets sms_sent_at; on retry it
-- checks this column and skips the send (and acks) if already populated.
--
-- Rows are only needed for the retry window (~12 hours for Cloudflare Queues).
-- TODO: add a periodic cleanup job to DELETE WHERE created_at < datetime('now', '-1 day').

CREATE TABLE IF NOT EXISTS queue_processing_locks (
  queue_message_id TEXT PRIMARY KEY,
  lead_id          TEXT NOT NULL,
  sms_sent_at      TEXT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);
