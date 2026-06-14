-- Staff roles, nicknames, invites, activity tracking, message attribution
ALTER TABLE staff_users ADD COLUMN role TEXT NOT NULL DEFAULT 'member';
ALTER TABLE staff_users ADD COLUMN display_name TEXT;
ALTER TABLE staff_users ADD COLUMN profile_complete INTEGER NOT NULL DEFAULT 0;
ALTER TABLE staff_users ADD COLUMN invited_by TEXT REFERENCES staff_users(id);
ALTER TABLE staff_users ADD COLUMN status TEXT NOT NULL DEFAULT 'active';

ALTER TABLE messages ADD COLUMN staff_user_id TEXT REFERENCES staff_users(id);
ALTER TABLE messages ADD COLUMN staff_author_name TEXT;

CREATE TABLE IF NOT EXISTS staff_activity_log (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  staff_user_id TEXT NOT NULL REFERENCES staff_users(id),
  staff_display_name TEXT NOT NULL,
  action TEXT NOT NULL,
  lead_id TEXT,
  metadata_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_staff_activity_org ON staff_activity_log(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_staff_activity_user ON staff_activity_log(staff_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_staff_activity_lead ON staff_activity_log(lead_id);

-- Existing users keep access; new installs require invite (except superadmin email)
UPDATE staff_users SET status = 'active', profile_complete = 1 WHERE display_name IS NULL AND name != '';
