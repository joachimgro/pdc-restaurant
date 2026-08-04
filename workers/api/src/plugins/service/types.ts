/**
 * D1 row shapes for the service module. These mirror the migration DDL
 * exactly (snake_case, integers for booleans) and stay internal to the db
 * modules — everything crossing the API boundary uses the camelCase Zod
 * schemas in @lead-intake/shared-types.
 */

export type VenueSettingsRow = {
  location_id: string;
  organization_id: string;
  timezone: string;
  booking_slug: string | null;
  slot_interval_min: number;
  default_turn_minutes: number;
  grace_after_close_min: number;
  min_party_online: number;
  max_party_online: number;
  large_party_message: string | null;
  min_lead_minutes: number;
  max_advance_days: number;
  hold_ttl_seconds: number;
  auto_assign_tables: number;
  allow_online_waitlist: number;
  cancellation_window_hours: number;
  brand_json: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  address_text: string | null;
};

export type RoomRow = {
  id: string;
  organization_id: string;
  location_id: string;
  name: string;
  accent_color: string | null;
  online_bookable: number;
  canvas_width: number;
  canvas_height: number;
  sort_order: number;
  is_active: number;
};

export type DiningTableRow = {
  id: string;
  organization_id: string;
  location_id: string;
  room_id: string;
  label: string;
  seats_min: number;
  seats_max: number;
  shape: string;
  pos_x: number;
  pos_y: number;
  width: number;
  height: number;
  rotation: number;
  online_bookable: number;
  assign_priority: number;
  is_active: number;
  notes: string | null;
};

export type TableCombinationRow = {
  id: string;
  organization_id: string;
  location_id: string;
  label: string;
  seats_min: number;
  seats_max: number;
  assign_priority: number;
  online_bookable: number;
  is_active: number;
};

export type ServicePeriodRow = {
  id: string;
  organization_id: string;
  location_id: string;
  name: string;
  day_of_week: string;
  start_time: string;
  end_time: string;
  last_seating_time: string;
  slot_interval_min: number | null;
  online_bookable: number;
  sort_order: number;
  is_active: number;
};

export type TurnTimeRuleRow = {
  id: string;
  organization_id: string;
  location_id: string;
  service_period_id: string | null;
  party_min: number;
  party_max: number;
  turn_minutes: number;
};

export type PacingRuleRow = {
  id: string;
  organization_id: string;
  location_id: string;
  service_period_id: string | null;
  interval_min: number;
  max_covers: number | null;
  max_bookings: number | null;
  applies_from: string | null;
  applies_to: string | null;
  is_active: number;
};

export type AvailabilityExceptionRow = {
  id: string;
  organization_id: string;
  location_id: string;
  service_date: string;
  kind: string;
  start_time: string | null;
  end_time: string | null;
  room_id: string | null;
  table_id: string | null;
  override_last_seating: string | null;
  note: string | null;
  created_by_staff_id: string | null;
};

/** D1 stores booleans as 0/1. */
export function toBool(value: number): boolean {
  return value === 1;
}

export function toInt(value: boolean): number {
  return value ? 1 : 0;
}
