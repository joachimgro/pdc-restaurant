import type { Env } from "../../../env";
import { toBool, type RoomRow } from "../types";

export type RoomSummary = {
  id: string;
  name: string;
  accentColor: string | null;
  onlineBookable: boolean;
  canvasWidth: number;
  canvasHeight: number;
  sortOrder: number;
  isActive: boolean;
};

export function rowToRoomSummary(row: RoomRow): RoomSummary {
  return {
    id: row.id,
    name: row.name,
    accentColor: row.accent_color,
    onlineBookable: toBool(row.online_bookable),
    canvasWidth: row.canvas_width,
    canvasHeight: row.canvas_height,
    sortOrder: row.sort_order,
    isActive: toBool(row.is_active),
  };
}

/**
 * Rooms for a location. Ordering is deterministic (sort_order, then id) so the
 * floor plan round-trips identically across reads.
 */
export async function listRooms(
  env: Env,
  locationId: string
): Promise<RoomRow[]> {
  const { results } = await env.DB.prepare(
    `SELECT * FROM rooms
     WHERE location_id = ? AND organization_id = ?
     ORDER BY sort_order ASC, id ASC`
  )
    .bind(locationId, env.ORGANIZATION_ID)
    .all<RoomRow>();
  return results ?? [];
}

export async function getRoom(
  env: Env,
  roomId: string
): Promise<RoomRow | null> {
  return env.DB.prepare(
    `SELECT * FROM rooms WHERE id = ? AND organization_id = ?`
  )
    .bind(roomId, env.ORGANIZATION_ID)
    .first<RoomRow>();
}
