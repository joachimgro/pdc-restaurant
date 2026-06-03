-- Preferred trial class time (e.g. Bolton: 17:00, 19:30, 20:30)
ALTER TABLE leads ADD COLUMN trial_slot TEXT;
ALTER TABLE leads ADD COLUMN trial_slot_label TEXT;
