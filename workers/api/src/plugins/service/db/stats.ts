import type { Env } from "../../../env";

export type ServiceStats = {
  from: string;
  to: string;
  locationId: string;
  covers: number;
  bookings: number;
  finished: number;
  cancelled: number;
  noShows: number;
  seatedNow: number;
  noShowRate: number | null;
  cancelRate: number | null;
  avgTurnMinutes: number | null;
  /** Confirmed start → seated (how long until they were seated). */
  avgSeatLagMinutes: number | null;
  /** Seated → finished (time at table). */
  avgDwellMinutes: number | null;
  avgPartySize: number | null;
  sourceMix: { source: string; count: number }[];
  /** Hour-of-day booking starts (local start_time hour). */
  hourlyStarts: { hour: number; count: number; covers: number }[];
  waitlistConversion: number | null;
  waitlistTotal: number;
  waitlistConverted: number;
  /** Kitchen ticket speed when kitchen tables exist. */
  kitchenTickets: number;
  avgTicketMinutes: number | null;
  ticketsOver15Min: number;
};

type ReservationAggRow = {
  covers: number | null;
  bookings: number | null;
  no_shows: number | null;
  finished: number | null;
  cancelled: number | null;
  seated_now: number | null;
  avg_turn_minutes: number | null;
  avg_seat_lag_minutes: number | null;
  avg_dwell_minutes: number | null;
  avg_party_size: number | null;
};

export async function queryServiceStats(
  env: Env,
  locationId: string,
  from: string,
  to: string
): Promise<ServiceStats> {
  const orgId = env.ORGANIZATION_ID;

  const reservationAgg = await env.DB.prepare(
    `SELECT
       COALESCE(SUM(CASE WHEN status IN ('seated', 'finished') THEN party_size ELSE 0 END), 0) AS covers,
       COALESCE(SUM(CASE WHEN status NOT IN ('cancelled', 'expired') THEN 1 ELSE 0 END), 0) AS bookings,
       COALESCE(SUM(CASE WHEN status = 'no_show' THEN 1 ELSE 0 END), 0) AS no_shows,
       COALESCE(SUM(CASE WHEN status = 'finished' THEN 1 ELSE 0 END), 0) AS finished,
       COALESCE(SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END), 0) AS cancelled,
       COALESCE(SUM(CASE WHEN status = 'seated' THEN 1 ELSE 0 END), 0) AS seated_now,
       AVG(
         CASE
           WHEN status = 'finished' AND seated_at IS NOT NULL AND finished_at IS NOT NULL
           THEN (julianday(finished_at) - julianday(seated_at)) * 24.0 * 60.0
           WHEN status = 'finished' AND seated_at IS NULL AND finished_at IS NOT NULL
           THEN (julianday(finished_at) - julianday(starts_at_utc)) * 24.0 * 60.0
         END
       ) AS avg_turn_minutes,
       AVG(
         CASE
           WHEN seated_at IS NOT NULL
           THEN (julianday(seated_at) - julianday(starts_at_utc)) * 24.0 * 60.0
         END
       ) AS avg_seat_lag_minutes,
       AVG(
         CASE
           WHEN status = 'finished' AND seated_at IS NOT NULL AND finished_at IS NOT NULL
           THEN (julianday(finished_at) - julianday(seated_at)) * 24.0 * 60.0
         END
       ) AS avg_dwell_minutes,
       AVG(
         CASE
           WHEN status NOT IN ('cancelled', 'expired') THEN party_size
         END
       ) AS avg_party_size
     FROM reservations
     WHERE organization_id = ?
       AND location_id = ?
       AND service_date >= ?
       AND service_date <= ?`
  )
    .bind(orgId, locationId, from, to)
    .first<ReservationAggRow>();

  const sourceRows = await env.DB.prepare(
    `SELECT source, COUNT(*) AS count
     FROM reservations
     WHERE organization_id = ?
       AND location_id = ?
       AND service_date >= ?
       AND service_date <= ?
       AND status NOT IN ('cancelled', 'expired')
     GROUP BY source
     ORDER BY count DESC, source ASC`
  )
    .bind(orgId, locationId, from, to)
    .all<{ source: string; count: number }>();

  const hourlyRows = await env.DB.prepare(
    `SELECT CAST(substr(start_time, 1, 2) AS INTEGER) AS hour,
            COUNT(*) AS count,
            COALESCE(SUM(party_size), 0) AS covers
     FROM reservations
     WHERE organization_id = ?
       AND location_id = ?
       AND service_date >= ?
       AND service_date <= ?
       AND status NOT IN ('cancelled', 'expired')
     GROUP BY hour
     ORDER BY hour ASC`
  )
    .bind(orgId, locationId, from, to)
    .all<{ hour: number; count: number; covers: number }>();

  const waitlistRow = await env.DB.prepare(
    `SELECT
       COUNT(*) AS total,
       COALESCE(SUM(
         CASE
           WHEN seated_at IS NOT NULL
             OR reservation_id IS NOT NULL
             OR status IN ('seated', 'converted')
           THEN 1 ELSE 0
         END
       ), 0) AS converted
     FROM waitlist_entries
     WHERE organization_id = ?
       AND location_id = ?
       AND service_date >= ?
       AND service_date <= ?`
  )
    .bind(orgId, locationId, from, to)
    .first<{ total: number; converted: number }>();

  let kitchenTickets = 0;
  let avgTicketMinutes: number | null = null;
  let ticketsOver15Min = 0;
  try {
    const kitchen = await env.DB.prepare(
      `SELECT
         COUNT(*) AS total,
         AVG(
           CASE
             WHEN ready_at IS NOT NULL
             THEN (julianday(ready_at) - julianday(created_at)) * 24.0 * 60.0
             WHEN served_at IS NOT NULL
             THEN (julianday(served_at) - julianday(created_at)) * 24.0 * 60.0
           END
         ) AS avg_mins,
         COALESCE(SUM(
           CASE
             WHEN ready_at IS NOT NULL
              AND (julianday(ready_at) - julianday(created_at)) * 24.0 * 60.0 > 15
             THEN 1
             WHEN ready_at IS NULL AND served_at IS NOT NULL
              AND (julianday(served_at) - julianday(created_at)) * 24.0 * 60.0 > 15
             THEN 1
             ELSE 0
           END
         ), 0) AS slow
       FROM kitchen_tickets
       WHERE organization_id = ?
         AND location_id = ?
         AND date(created_at) >= ?
         AND date(created_at) <= ?`
    )
      .bind(orgId, locationId, from, to)
      .first<{ total: number; avg_mins: number | null; slow: number }>();
    kitchenTickets = kitchen?.total ?? 0;
    avgTicketMinutes = kitchen?.avg_mins ?? null;
    ticketsOver15Min = kitchen?.slow ?? 0;
  } catch {
    // Kitchen tables may be absent on older DBs mid-migrate.
  }

  const noShows = reservationAgg?.no_shows ?? 0;
  const finished = reservationAgg?.finished ?? 0;
  const cancelled = reservationAgg?.cancelled ?? 0;
  const bookings = reservationAgg?.bookings ?? 0;
  const seatDenom = noShows + finished + (reservationAgg?.seated_now ?? 0);

  const waitlistTotal = waitlistRow?.total ?? 0;
  const waitlistConverted = waitlistRow?.converted ?? 0;

  return {
    from,
    to,
    locationId,
    covers: reservationAgg?.covers ?? 0,
    bookings,
    finished,
    cancelled,
    noShows,
    seatedNow: reservationAgg?.seated_now ?? 0,
    noShowRate: seatDenom > 0 ? noShows / seatDenom : null,
    cancelRate:
      bookings + cancelled > 0 ? cancelled / (bookings + cancelled) : null,
    avgTurnMinutes: reservationAgg?.avg_turn_minutes ?? null,
    avgSeatLagMinutes: reservationAgg?.avg_seat_lag_minutes ?? null,
    avgDwellMinutes: reservationAgg?.avg_dwell_minutes ?? null,
    avgPartySize: reservationAgg?.avg_party_size ?? null,
    sourceMix: (sourceRows.results ?? []).map((r) => ({
      source: r.source,
      count: r.count,
    })),
    hourlyStarts: (hourlyRows.results ?? []).map((r) => ({
      hour: r.hour,
      count: r.count,
      covers: r.covers,
    })),
    waitlistConversion:
      waitlistTotal > 0 ? waitlistConverted / waitlistTotal : null,
    waitlistTotal,
    waitlistConverted,
    kitchenTickets,
    avgTicketMinutes,
    ticketsOver15Min,
  };
}
