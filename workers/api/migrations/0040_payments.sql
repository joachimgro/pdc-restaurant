-- Stripe deposit policies + payments (amounts in integer pence).
CREATE TABLE IF NOT EXISTS deposit_policies (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  location_id TEXT NOT NULL REFERENCES locations(id),
  name TEXT NOT NULL,
  mode TEXT NOT NULL,
  amount_pence INTEGER NOT NULL DEFAULT 0,
  no_show_fee_pence INTEGER NOT NULL DEFAULT 0,
  min_party INTEGER NOT NULL DEFAULT 1,
  service_period_id TEXT REFERENCES service_periods(id) ON DELETE CASCADE,
  day_of_week TEXT,
  date_from TEXT,
  date_to TEXT,
  cancellation_window_hours INTEGER NOT NULL DEFAULT 24,
  terms_text TEXT,
  priority INTEGER NOT NULL DEFAULT 100,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_deposit_policies_location
  ON deposit_policies(location_id, is_active, priority);

CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  location_id TEXT NOT NULL REFERENCES locations(id),
  reservation_id TEXT REFERENCES reservations(id),
  contact_id TEXT REFERENCES contacts(id),
  purpose TEXT NOT NULL DEFAULT 'deposit',
  status TEXT NOT NULL DEFAULT 'requires_action',
  amount_pence INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'gbp',
  stripe_checkout_session_id TEXT,
  stripe_payment_intent_id TEXT,
  stripe_setup_intent_id TEXT,
  checkout_url TEXT,
  authorized_at TEXT,
  captured_at TEXT,
  refunded_at TEXT,
  refunded_pence INTEGER NOT NULL DEFAULT 0,
  policy_id TEXT REFERENCES deposit_policies(id),
  error_text TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_payments_reservation ON payments(reservation_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_checkout
  ON payments(stripe_checkout_session_id) WHERE stripe_checkout_session_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS payment_events (
  id TEXT PRIMARY KEY,
  payment_id TEXT REFERENCES payments(id) ON DELETE CASCADE,
  stripe_event_id TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR REPLACE INTO _meta (key, value, updated_at)
VALUES ('schema_version', '0040', datetime('now'));
