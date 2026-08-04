import {
  validateFloorPlan,
  type DiningTable,
  type FloorPlan,
  type FloorPlanIssue,
  type Room,
  type TableCombination,
} from "@lead-intake/shared-types";
import type { Env } from "../../../env";
import { listRooms } from "./rooms";
import {
  toBool,
  toInt,
  type DiningTableRow,
  type RoomRow,
  type TableCombinationRow,
} from "../types";

export type SaveFloorPlanResult =
  | { ok: true; plan: FloorPlan }
  | { ok: false; issues: FloorPlanIssue[] };

function rowToTable(row: DiningTableRow): DiningTable {
  return {
    id: row.id,
    label: row.label,
    seatsMin: row.seats_min,
    seatsMax: row.seats_max,
    shape: row.shape as DiningTable["shape"],
    posX: row.pos_x,
    posY: row.pos_y,
    width: row.width,
    height: row.height,
    rotation: row.rotation,
    onlineBookable: toBool(row.online_bookable),
    assignPriority: row.assign_priority,
    isActive: toBool(row.is_active),
    notes: row.notes,
  };
}

function rowToRoom(row: RoomRow, tables: DiningTable[]): Room {
  return {
    id: row.id,
    name: row.name,
    accentColor: row.accent_color,
    onlineBookable: toBool(row.online_bookable),
    canvasWidth: row.canvas_width,
    canvasHeight: row.canvas_height,
    sortOrder: row.sort_order,
    isActive: toBool(row.is_active),
    tables,
  };
}

/**
 * The whole floor plan for a location.
 *
 * Ordering is fully deterministic — rooms by (sort_order, id), tables by
 * label, combinations by (label, id), members by their stored sort_order —
 * so this is byte-identical across repeated reads and after a save that wrote
 * the same payload back.
 */
export async function getFloorPlan(
  env: Env,
  locationId: string
): Promise<FloorPlan> {
  const roomRows = await listRooms(env, locationId);

  const { results: tableRows } = await env.DB.prepare(
    `SELECT * FROM dining_tables
     WHERE location_id = ? AND organization_id = ?
     ORDER BY label ASC`
  )
    .bind(locationId, env.ORGANIZATION_ID)
    .all<DiningTableRow>();

  const tablesByRoom = new Map<string, DiningTable[]>();
  for (const row of tableRows ?? []) {
    const list = tablesByRoom.get(row.room_id) ?? [];
    list.push(rowToTable(row));
    tablesByRoom.set(row.room_id, list);
  }

  const { results: comboRows } = await env.DB.prepare(
    `SELECT * FROM table_combinations
     WHERE location_id = ? AND organization_id = ?
     ORDER BY label ASC, id ASC`
  )
    .bind(locationId, env.ORGANIZATION_ID)
    .all<TableCombinationRow>();

  const { results: memberRows } = await env.DB.prepare(
    `SELECT m.combination_id, m.table_id
     FROM table_combination_members m
     JOIN table_combinations c ON c.id = m.combination_id
     WHERE c.location_id = ? AND c.organization_id = ?
     ORDER BY m.sort_order ASC, m.table_id ASC`
  )
    .bind(locationId, env.ORGANIZATION_ID)
    .all<{ combination_id: string; table_id: string }>();

  const membersByCombo = new Map<string, string[]>();
  for (const row of memberRows ?? []) {
    const list = membersByCombo.get(row.combination_id) ?? [];
    list.push(row.table_id);
    membersByCombo.set(row.combination_id, list);
  }

  const combinations: TableCombination[] = (comboRows ?? []).map((row) => ({
    id: row.id,
    label: row.label,
    seatsMin: row.seats_min,
    seatsMax: row.seats_max,
    assignPriority: row.assign_priority,
    onlineBookable: toBool(row.online_bookable),
    isActive: toBool(row.is_active),
    tableIds: membersByCombo.get(row.id) ?? [],
  }));

  return {
    rooms: roomRows.map((row) => rowToRoom(row, tablesByRoom.get(row.id) ?? [])),
    combinations,
  };
}

/**
 * Replace the submitted rooms' tables and the location's combinations in a
 * single env.DB.batch(), which D1 runs as one transaction.
 *
 * A half-applied save is the worst failure this module has: a room left with
 * orphaned tables, or combinations pointing at tables that no longer exist,
 * is invisible until service and corrupts every availability query after it.
 * So it is all-or-nothing, and it is validated in full before a single write.
 *
 * Rooms absent from the payload are left untouched. Because a combination may
 * only reference tables present in the payload, a plan whose combinations span
 * rooms must submit all of those rooms.
 */
export async function saveFloorPlan(
  env: Env,
  locationId: string,
  plan: FloorPlan
): Promise<SaveFloorPlanResult> {
  const issues = validateFloorPlan(plan);

  const payloadRoomIds = plan.rooms.map((r) => r.id);

  // A room id already owned by another location would silently migrate.
  if (payloadRoomIds.length > 0) {
    const placeholders = payloadRoomIds.map(() => "?").join(", ");
    const { results: existing } = await env.DB.prepare(
      `SELECT id, location_id FROM rooms
       WHERE organization_id = ? AND id IN (${placeholders})`
    )
      .bind(env.ORGANIZATION_ID, ...payloadRoomIds)
      .all<{ id: string; location_id: string }>();

    for (const row of existing ?? []) {
      if (row.location_id !== locationId) {
        issues.push({
          roomId: row.id,
          field: "id",
          message: `Room "${row.id}" belongs to location "${row.location_id}" and cannot be moved by a floor plan save`,
        });
      }
    }
  }

  // UNIQUE(location_id, label) spans the venue, so a label may also collide
  // with a table in a room that was not submitted.
  const payloadLabels = plan.rooms.flatMap((r) => r.tables.map((t) => t.label));
  if (payloadLabels.length > 0) {
    const labelPlaceholders = payloadLabels.map(() => "?").join(", ");
    const roomFilter =
      payloadRoomIds.length > 0
        ? `AND room_id NOT IN (${payloadRoomIds.map(() => "?").join(", ")})`
        : "";

    const { results: clashes } = await env.DB.prepare(
      `SELECT label, room_id FROM dining_tables
       WHERE location_id = ? AND organization_id = ?
         AND label IN (${labelPlaceholders}) ${roomFilter}`
    )
      .bind(
        locationId,
        env.ORGANIZATION_ID,
        ...payloadLabels,
        ...payloadRoomIds
      )
      .all<{ label: string; room_id: string }>();

    for (const row of clashes ?? []) {
      issues.push({
        tableLabel: row.label,
        field: "label",
        message: `Table label "${row.label}" is already used in room "${row.room_id}", which was not part of this save`,
      });
    }
  }

  if (issues.length > 0) return { ok: false, issues };

  const statements: D1PreparedStatement[] = [];

  // Combinations are rebuilt wholesale, so clear members first: they reference
  // both combinations and tables, and must not outlive either.
  statements.push(
    env.DB.prepare(
      `DELETE FROM table_combination_members
       WHERE combination_id IN (
         SELECT id FROM table_combinations
         WHERE location_id = ? AND organization_id = ?
       )`
    ).bind(locationId, env.ORGANIZATION_ID)
  );
  statements.push(
    env.DB.prepare(
      `DELETE FROM table_combinations
       WHERE location_id = ? AND organization_id = ?`
    ).bind(locationId, env.ORGANIZATION_ID)
  );

  for (const room of plan.rooms) {
    statements.push(
      env.DB.prepare(
        `DELETE FROM dining_tables WHERE room_id = ? AND organization_id = ?`
      ).bind(room.id, env.ORGANIZATION_ID)
    );
  }

  for (const room of plan.rooms) {
    statements.push(
      env.DB.prepare(
        `INSERT INTO rooms (
           id, organization_id, location_id, name, accent_color, online_bookable,
           canvas_width, canvas_height, sort_order, is_active
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           accent_color = excluded.accent_color,
           online_bookable = excluded.online_bookable,
           canvas_width = excluded.canvas_width,
           canvas_height = excluded.canvas_height,
           sort_order = excluded.sort_order,
           is_active = excluded.is_active,
           updated_at = datetime('now')`
      ).bind(
        room.id,
        env.ORGANIZATION_ID,
        locationId,
        room.name,
        room.accentColor,
        toInt(room.onlineBookable),
        room.canvasWidth,
        room.canvasHeight,
        room.sortOrder,
        toInt(room.isActive)
      )
    );

    for (const table of room.tables) {
      statements.push(
        env.DB.prepare(
          `INSERT INTO dining_tables (
             id, organization_id, location_id, room_id, label, seats_min,
             seats_max, shape, pos_x, pos_y, width, height, rotation,
             online_bookable, assign_priority, is_active, notes
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
          table.id,
          env.ORGANIZATION_ID,
          locationId,
          room.id,
          table.label,
          table.seatsMin,
          table.seatsMax,
          table.shape,
          table.posX,
          table.posY,
          table.width,
          table.height,
          table.rotation,
          toInt(table.onlineBookable),
          table.assignPriority,
          toInt(table.isActive),
          table.notes
        )
      );
    }
  }

  for (const combo of plan.combinations) {
    statements.push(
      env.DB.prepare(
        `INSERT INTO table_combinations (
           id, organization_id, location_id, label, seats_min, seats_max,
           assign_priority, online_bookable, is_active
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        combo.id,
        env.ORGANIZATION_ID,
        locationId,
        combo.label,
        combo.seatsMin,
        combo.seatsMax,
        combo.assignPriority,
        toInt(combo.onlineBookable),
        toInt(combo.isActive)
      )
    );

    combo.tableIds.forEach((tableId, index) => {
      statements.push(
        env.DB.prepare(
          `INSERT INTO table_combination_members (combination_id, table_id, sort_order)
           VALUES (?, ?, ?)`
        ).bind(combo.id, tableId, index)
      );
    });
  }

  await env.DB.batch(statements);

  return { ok: true, plan: await getFloorPlan(env, locationId) };
}

/** Active, bookable tables for a location. Used by the assignment engine. */
export async function listActiveTables(
  env: Env,
  locationId: string
): Promise<DiningTableRow[]> {
  const { results } = await env.DB.prepare(
    `SELECT * FROM dining_tables
     WHERE location_id = ? AND organization_id = ? AND is_active = 1
     ORDER BY label ASC`
  )
    .bind(locationId, env.ORGANIZATION_ID)
    .all<DiningTableRow>();
  return results ?? [];
}
