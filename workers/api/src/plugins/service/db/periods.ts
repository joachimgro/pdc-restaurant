import type {
  PacingRule,
  ServicePeriod,
  ServicePeriodInput,
  ServicePeriodsResponse,
  TurnTimeRule,
} from "@lead-intake/shared-types";
import type { Env } from "../../../env";
import {
  toBool,
  toInt,
  type PacingRuleRow,
  type ServicePeriodRow,
  type TurnTimeRuleRow,
} from "../types";

function rowToTurnRule(row: TurnTimeRuleRow): TurnTimeRule {
  return {
    id: row.id,
    partyMin: row.party_min,
    partyMax: row.party_max,
    turnMinutes: row.turn_minutes,
  };
}

function rowToPacingRule(row: PacingRuleRow): PacingRule {
  return {
    id: row.id,
    intervalMin: row.interval_min,
    maxCovers: row.max_covers,
    maxBookings: row.max_bookings,
    appliesFrom: row.applies_from,
    appliesTo: row.applies_to,
    isActive: toBool(row.is_active),
  };
}

/**
 * Every period for a location with its rooms and rules attached, plus the
 * venue-scoped rules (those with a null service_period_id) which apply
 * wherever a period-scoped rule does not.
 */
export async function listServicePeriods(
  env: Env,
  locationId: string
): Promise<ServicePeriodsResponse> {
  const { results: periodRows } = await env.DB.prepare(
    `SELECT * FROM service_periods
     WHERE location_id = ? AND organization_id = ?
     ORDER BY sort_order ASC, start_time ASC, id ASC`
  )
    .bind(locationId, env.ORGANIZATION_ID)
    .all<ServicePeriodRow>();

  const { results: roomLinks } = await env.DB.prepare(
    `SELECT r.service_period_id, r.room_id
     FROM service_period_rooms r
     JOIN service_periods p ON p.id = r.service_period_id
     WHERE p.location_id = ? AND p.organization_id = ?
     ORDER BY r.room_id ASC`
  )
    .bind(locationId, env.ORGANIZATION_ID)
    .all<{ service_period_id: string; room_id: string }>();

  const { results: turnRows } = await env.DB.prepare(
    `SELECT * FROM turn_time_rules
     WHERE location_id = ? AND organization_id = ?
     ORDER BY party_min ASC, party_max ASC, id ASC`
  )
    .bind(locationId, env.ORGANIZATION_ID)
    .all<TurnTimeRuleRow>();

  const { results: pacingRows } = await env.DB.prepare(
    `SELECT * FROM pacing_rules
     WHERE location_id = ? AND organization_id = ?
     ORDER BY interval_min ASC, id ASC`
  )
    .bind(locationId, env.ORGANIZATION_ID)
    .all<PacingRuleRow>();

  const roomsByPeriod = new Map<string, string[]>();
  for (const link of roomLinks ?? []) {
    const list = roomsByPeriod.get(link.service_period_id) ?? [];
    list.push(link.room_id);
    roomsByPeriod.set(link.service_period_id, list);
  }

  const turnByPeriod = new Map<string, TurnTimeRule[]>();
  const venueTurnRules: TurnTimeRule[] = [];
  for (const row of turnRows ?? []) {
    if (row.service_period_id === null) {
      venueTurnRules.push(rowToTurnRule(row));
      continue;
    }
    const list = turnByPeriod.get(row.service_period_id) ?? [];
    list.push(rowToTurnRule(row));
    turnByPeriod.set(row.service_period_id, list);
  }

  const pacingByPeriod = new Map<string, PacingRule[]>();
  const venuePacingRules: PacingRule[] = [];
  for (const row of pacingRows ?? []) {
    if (row.service_period_id === null) {
      venuePacingRules.push(rowToPacingRule(row));
      continue;
    }
    const list = pacingByPeriod.get(row.service_period_id) ?? [];
    list.push(rowToPacingRule(row));
    pacingByPeriod.set(row.service_period_id, list);
  }

  const periods: ServicePeriod[] = (periodRows ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    dayOfWeek: row.day_of_week as ServicePeriod["dayOfWeek"],
    startTime: row.start_time,
    endTime: row.end_time,
    lastSeatingTime: row.last_seating_time,
    slotIntervalMin: row.slot_interval_min,
    onlineBookable: toBool(row.online_bookable),
    sortOrder: row.sort_order,
    isActive: toBool(row.is_active),
    roomIds: roomsByPeriod.get(row.id) ?? [],
    turnRules: turnByPeriod.get(row.id) ?? [],
    pacingRules: pacingByPeriod.get(row.id) ?? [],
  }));

  return { periods, venueTurnRules, venuePacingRules };
}

export async function getServicePeriod(
  env: Env,
  periodId: string
): Promise<ServicePeriodRow | null> {
  return env.DB.prepare(
    `SELECT * FROM service_periods WHERE id = ? AND organization_id = ?`
  )
    .bind(periodId, env.ORGANIZATION_ID)
    .first<ServicePeriodRow>();
}

/**
 * Write a period with its room links and rules in one batch. A period whose
 * turn rules failed to write would silently fall back to the venue default
 * turn time, which is the kind of wrong that only shows up as a double-booked
 * table three weeks later.
 */
export async function upsertServicePeriod(
  env: Env,
  locationId: string,
  periodId: string,
  input: ServicePeriodInput
): Promise<ServicePeriod | null> {
  const statements: D1PreparedStatement[] = [
    env.DB.prepare(
      `INSERT INTO service_periods (
         id, organization_id, location_id, name, day_of_week, start_time,
         end_time, last_seating_time, slot_interval_min, online_bookable,
         sort_order, is_active
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         day_of_week = excluded.day_of_week,
         start_time = excluded.start_time,
         end_time = excluded.end_time,
         last_seating_time = excluded.last_seating_time,
         slot_interval_min = excluded.slot_interval_min,
         online_bookable = excluded.online_bookable,
         sort_order = excluded.sort_order,
         is_active = excluded.is_active,
         updated_at = datetime('now')`
    ).bind(
      periodId,
      env.ORGANIZATION_ID,
      locationId,
      input.name,
      input.dayOfWeek,
      input.startTime,
      input.endTime,
      input.lastSeatingTime,
      input.slotIntervalMin ?? null,
      toInt(input.onlineBookable),
      input.sortOrder ?? 0,
      toInt(input.isActive ?? true)
    ),
    env.DB.prepare(
      `DELETE FROM service_period_rooms WHERE service_period_id = ?`
    ).bind(periodId),
    env.DB.prepare(
      `DELETE FROM turn_time_rules
       WHERE service_period_id = ? AND organization_id = ?`
    ).bind(periodId, env.ORGANIZATION_ID),
    env.DB.prepare(
      `DELETE FROM pacing_rules
       WHERE service_period_id = ? AND organization_id = ?`
    ).bind(periodId, env.ORGANIZATION_ID),
  ];

  for (const roomId of input.roomIds) {
    statements.push(
      env.DB.prepare(
        `INSERT INTO service_period_rooms (service_period_id, room_id)
         VALUES (?, ?)`
      ).bind(periodId, roomId)
    );
  }

  for (const rule of input.turnRules) {
    statements.push(
      env.DB.prepare(
        `INSERT INTO turn_time_rules (
           id, organization_id, location_id, service_period_id,
           party_min, party_max, turn_minutes
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        crypto.randomUUID(),
        env.ORGANIZATION_ID,
        locationId,
        periodId,
        rule.partyMin,
        rule.partyMax,
        rule.turnMinutes
      )
    );
  }

  for (const rule of input.pacingRules) {
    statements.push(
      env.DB.prepare(
        `INSERT INTO pacing_rules (
           id, organization_id, location_id, service_period_id, interval_min,
           max_covers, max_bookings, applies_from, applies_to, is_active
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        crypto.randomUUID(),
        env.ORGANIZATION_ID,
        locationId,
        periodId,
        rule.intervalMin,
        rule.maxCovers,
        rule.maxBookings,
        rule.appliesFrom,
        rule.appliesTo,
        toInt(rule.isActive)
      )
    );
  }

  await env.DB.batch(statements);

  const { periods } = await listServicePeriods(env, locationId);
  return periods.find((p) => p.id === periodId) ?? null;
}

/** Removes the period; rules and room links cascade on service_period_id. */
export async function deleteServicePeriod(
  env: Env,
  periodId: string
): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(
      `DELETE FROM service_period_rooms WHERE service_period_id = ?`
    ).bind(periodId),
    env.DB.prepare(
      `DELETE FROM turn_time_rules
       WHERE service_period_id = ? AND organization_id = ?`
    ).bind(periodId, env.ORGANIZATION_ID),
    env.DB.prepare(
      `DELETE FROM pacing_rules
       WHERE service_period_id = ? AND organization_id = ?`
    ).bind(periodId, env.ORGANIZATION_ID),
    env.DB.prepare(
      `DELETE FROM service_periods WHERE id = ? AND organization_id = ?`
    ).bind(periodId, env.ORGANIZATION_ID),
  ]);
}
