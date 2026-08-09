import type { VenueSettings, VenueSettingsInput } from "@lead-intake/shared-types";
import type { Env } from "../../../env";
import { toBool, toInt, type VenueSettingsRow } from "../types";

/** Defaults mirror the 0034 DDL, so an unconfigured venue reads back sanely. */
const DEFAULTS = {
  timezone: "Europe/London",
  slotIntervalMin: 15,
  defaultTurnMinutes: 90,
  graceAfterCloseMin: 30,
  minPartyOnline: 1,
  maxPartyOnline: 8,
  maxPartyCombined: 12,
  minLeadMinutes: 60,
  maxAdvanceDays: 90,
  holdTtlSeconds: 600,
  autoAssignTables: true,
  allowOnlineWaitlist: true,
  cancellationWindowHours: 24,
  reviewRequestDelayHours: 4,
  noShowGraceMin: 15,
  quietHoursStart: "21:00",
  quietHoursEnd: "08:00",
  retentionMonths: 24,
} as const;

function rowToSettings(row: VenueSettingsRow): VenueSettings {
  let brand: Record<string, unknown> | null = null;
  if (row.brand_json) {
    try {
      const parsed: unknown = JSON.parse(row.brand_json);
      brand =
        parsed && typeof parsed === "object" && !Array.isArray(parsed)
          ? (parsed as Record<string, unknown>)
          : null;
    } catch {
      brand = null;
    }
  }

  return {
    locationId: row.location_id,
    timezone: row.timezone,
    bookingSlug: row.booking_slug,
    slotIntervalMin: row.slot_interval_min,
    defaultTurnMinutes: row.default_turn_minutes,
    graceAfterCloseMin: row.grace_after_close_min,
    minPartyOnline: row.min_party_online,
    maxPartyOnline: row.max_party_online,
    largePartyMessage: row.large_party_message,
    minLeadMinutes: row.min_lead_minutes,
    maxAdvanceDays: row.max_advance_days,
    holdTtlSeconds: row.hold_ttl_seconds,
    autoAssignTables: toBool(row.auto_assign_tables),
    allowOnlineWaitlist: toBool(row.allow_online_waitlist),
    cancellationWindowHours: row.cancellation_window_hours,
    brand,
    contactPhone: row.contact_phone,
    contactEmail: row.contact_email,
    addressText: row.address_text,
    maxPartyCombined: row.max_party_combined ?? DEFAULTS.maxPartyCombined,
    reviewUrl: row.review_url ?? null,
    reviewRequestDelayHours:
      row.review_request_delay_hours ?? DEFAULTS.reviewRequestDelayHours,
    noShowGraceMin: row.no_show_grace_min ?? DEFAULTS.noShowGraceMin,
    quietHoursStart: row.quiet_hours_start ?? DEFAULTS.quietHoursStart,
    quietHoursEnd: row.quiet_hours_end ?? DEFAULTS.quietHoursEnd,
    retentionMonths: row.retention_months ?? DEFAULTS.retentionMonths,
  };
}

/**
 * Venue settings for a location, or the schema defaults when the venue has
 * never been configured. Always returns a full object so GET → PUT → GET
 * round-trips even before the first save.
 */
export async function getVenueSettings(
  env: Env,
  locationId: string
): Promise<VenueSettings> {
  const row = await env.DB.prepare(
    `SELECT * FROM venue_settings WHERE location_id = ? AND organization_id = ?`
  )
    .bind(locationId, env.ORGANIZATION_ID)
    .first<VenueSettingsRow>();

  if (row) return rowToSettings(row);

  return {
    locationId,
    ...DEFAULTS,
    bookingSlug: null,
    largePartyMessage: null,
    brand: null,
    contactPhone: null,
    contactEmail: null,
    addressText: null,
    maxPartyCombined: DEFAULTS.maxPartyCombined,
    reviewUrl: null,
    reviewRequestDelayHours: DEFAULTS.reviewRequestDelayHours,
  };
}

export async function upsertVenueSettings(
  env: Env,
  locationId: string,
  input: VenueSettingsInput
): Promise<VenueSettings> {
  await env.DB.prepare(
    `INSERT INTO venue_settings (
       location_id, organization_id, timezone, booking_slug, slot_interval_min,
       default_turn_minutes, grace_after_close_min, min_party_online,
       max_party_online, large_party_message, min_lead_minutes, max_advance_days,
       hold_ttl_seconds, auto_assign_tables, allow_online_waitlist,
       cancellation_window_hours, brand_json, contact_phone, contact_email,
       address_text, max_party_combined, review_url, review_request_delay_hours,
       no_show_grace_min, quiet_hours_start, quiet_hours_end, retention_months
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(location_id) DO UPDATE SET
       timezone = excluded.timezone,
       booking_slug = excluded.booking_slug,
       slot_interval_min = excluded.slot_interval_min,
       default_turn_minutes = excluded.default_turn_minutes,
       grace_after_close_min = excluded.grace_after_close_min,
       min_party_online = excluded.min_party_online,
       max_party_online = excluded.max_party_online,
       large_party_message = excluded.large_party_message,
       min_lead_minutes = excluded.min_lead_minutes,
       max_advance_days = excluded.max_advance_days,
       hold_ttl_seconds = excluded.hold_ttl_seconds,
       auto_assign_tables = excluded.auto_assign_tables,
       allow_online_waitlist = excluded.allow_online_waitlist,
       cancellation_window_hours = excluded.cancellation_window_hours,
       brand_json = excluded.brand_json,
       contact_phone = excluded.contact_phone,
       contact_email = excluded.contact_email,
       address_text = excluded.address_text,
       max_party_combined = excluded.max_party_combined,
       review_url = excluded.review_url,
       review_request_delay_hours = excluded.review_request_delay_hours,
       no_show_grace_min = excluded.no_show_grace_min,
       quiet_hours_start = excluded.quiet_hours_start,
       quiet_hours_end = excluded.quiet_hours_end,
       retention_months = excluded.retention_months,
       updated_at = datetime('now')`
  )
    .bind(
      locationId,
      env.ORGANIZATION_ID,
      input.timezone,
      input.bookingSlug,
      input.slotIntervalMin,
      input.defaultTurnMinutes,
      input.graceAfterCloseMin,
      input.minPartyOnline,
      input.maxPartyOnline,
      input.largePartyMessage,
      input.minLeadMinutes,
      input.maxAdvanceDays,
      input.holdTtlSeconds,
      toInt(input.autoAssignTables),
      toInt(input.allowOnlineWaitlist),
      input.cancellationWindowHours,
      input.brand ? JSON.stringify(input.brand) : null,
      input.contactPhone,
      input.contactEmail,
      input.addressText,
      input.maxPartyCombined,
      input.reviewUrl,
      input.reviewRequestDelayHours,
      input.noShowGraceMin,
      input.quietHoursStart,
      input.quietHoursEnd,
      input.retentionMonths
    )
    .run();

  return getVenueSettings(env, locationId);
}

/** Resolves a public booking slug to its location. Used by /book/:slug later. */
export async function findLocationByBookingSlug(
  env: Env,
  slug: string
): Promise<string | null> {
  const row = await env.DB.prepare(
    `SELECT location_id FROM venue_settings
     WHERE booking_slug = ? AND organization_id = ?`
  )
    .bind(slug, env.ORGANIZATION_ID)
    .first<{ location_id: string }>();
  return row?.location_id ?? null;
}
