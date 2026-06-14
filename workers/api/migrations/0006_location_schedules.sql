-- Per-programme class schedule at each location (day + time)
CREATE TABLE IF NOT EXISTS location_programme_schedules (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  location_id TEXT NOT NULL REFERENCES locations(id),
  programme TEXT NOT NULL,
  day_of_week TEXT NOT NULL,
  start_time TEXT NOT NULL,
  display_label TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_schedules_location
  ON location_programme_schedules(location_id, programme);

-- TODO: add client schedule rows here after creating locations, or manage them
-- via the Admin panel -> Locations -> Schedules.
-- Format: (id, organization_id, location_id, programme, day_of_week, start_time, display_label, sort_order)
-- Example:
-- INSERT OR IGNORE INTO location_programme_schedules
--   (id, organization_id, location_id, programme, day_of_week, start_time, display_label, sort_order)
-- VALUES
--   ('sched-main-bjj-mon-1900', 'CHANGE_ME', 'main', 'Adults BJJ', 'mon', '19:00', '7pm', 0);
