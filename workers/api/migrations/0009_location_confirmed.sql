-- Track whether the location has been explicitly confirmed by the lead.
-- Form leads: 1 (they chose a location/programme on the form)
-- SMS-only leads: 0 until they tell us which branch they want

ALTER TABLE leads ADD COLUMN location_confirmed INTEGER NOT NULL DEFAULT 1;

-- Mark all existing SMS-only leads as unconfirmed
UPDATE leads SET location_confirmed = 0
WHERE source IN ('SMS', 'telnyx', 'inbound', 'sms')
  AND interest = 'Unknown';
