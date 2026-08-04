import { TABLE_SHAPES, type FloorPlan } from "./service";

/**
 * Semantic validation for a whole floor plan payload. Pure — no DB access —
 * so it is trivially unit testable.
 *
 * Nothing here clamps or corrects. A table that arrives outside the canvas is
 * rejected with its label and the reason, because a table silently snapping to
 * a corner is reported by the manager as "it moved my table" and costs an hour
 * to diagnose.
 *
 * Cross-payload checks that need the database (a label colliding with a table
 * in a room that was not submitted) live in db/tables.ts.
 */

export type FloorPlanIssue = {
  roomId?: string;
  tableLabel?: string;
  combinationLabel?: string;
  field: string;
  message: string;
};

export function validateFloorPlan(plan: FloorPlan): FloorPlanIssue[] {
  const issues: FloorPlanIssue[] = [];

  const seenRoomIds = new Set<string>();
  const seenTableIds = new Set<string>();
  const labelOwner = new Map<string, string>();
  const tableIdsInPayload = new Set<string>();

  for (const room of plan.rooms) {
    if (seenRoomIds.has(room.id)) {
      issues.push({
        roomId: room.id,
        field: "id",
        message: `Duplicate room id "${room.id}" in payload`,
      });
    }
    seenRoomIds.add(room.id);

    for (const table of room.tables) {
      tableIdsInPayload.add(table.id);

      if (seenTableIds.has(table.id)) {
        issues.push({
          roomId: room.id,
          tableLabel: table.label,
          field: "id",
          message: `Duplicate table id "${table.id}" in payload`,
        });
      }
      seenTableIds.add(table.id);

      // UNIQUE(location_id, label) — catch it here with a useful message
      // instead of surfacing a raw SQLite constraint error.
      const previous = labelOwner.get(table.label);
      if (previous !== undefined) {
        issues.push({
          roomId: room.id,
          tableLabel: table.label,
          field: "label",
          message: `Table label "${table.label}" is already used in room "${previous}". Labels must be unique across the venue.`,
        });
      } else {
        labelOwner.set(table.label, room.id);
      }

      if (table.seatsMin > table.seatsMax) {
        issues.push({
          roomId: room.id,
          tableLabel: table.label,
          field: "seatsMin",
          message: `seatsMin (${table.seatsMin}) must not exceed seatsMax (${table.seatsMax})`,
        });
      }

      if (!TABLE_SHAPES.includes(table.shape)) {
        issues.push({
          roomId: room.id,
          tableLabel: table.label,
          field: "shape",
          message: `Unknown shape "${table.shape}"`,
        });
      }

      if (table.rotation < 0 || table.rotation > 359) {
        issues.push({
          roomId: room.id,
          tableLabel: table.label,
          field: "rotation",
          message: `rotation must be 0-359, got ${table.rotation}`,
        });
      }

      // The whole table must sit on the canvas, not just its origin.
      if (table.posX < 0 || table.posY < 0) {
        issues.push({
          roomId: room.id,
          tableLabel: table.label,
          field: "posX",
          message: `Position (${table.posX}, ${table.posY}) is outside the canvas — coordinates cannot be negative`,
        });
      }
      if (table.posX + table.width > room.canvasWidth) {
        issues.push({
          roomId: room.id,
          tableLabel: table.label,
          field: "posX",
          message: `Table extends to x=${
            table.posX + table.width
          }, past the room canvas width of ${room.canvasWidth}`,
        });
      }
      if (table.posY + table.height > room.canvasHeight) {
        issues.push({
          roomId: room.id,
          tableLabel: table.label,
          field: "posY",
          message: `Table extends to y=${
            table.posY + table.height
          }, past the room canvas height of ${room.canvasHeight}`,
        });
      }
    }
  }

  const seenCombinationIds = new Set<string>();
  for (const combo of plan.combinations) {
    if (seenCombinationIds.has(combo.id)) {
      issues.push({
        combinationLabel: combo.label,
        field: "id",
        message: `Duplicate combination id "${combo.id}" in payload`,
      });
    }
    seenCombinationIds.add(combo.id);

    if (combo.seatsMin > combo.seatsMax) {
      issues.push({
        combinationLabel: combo.label,
        field: "seatsMin",
        message: `seatsMin (${combo.seatsMin}) must not exceed seatsMax (${combo.seatsMax})`,
      });
    }

    const seenMembers = new Set<string>();
    for (const tableId of combo.tableIds) {
      if (seenMembers.has(tableId)) {
        issues.push({
          combinationLabel: combo.label,
          field: "tableIds",
          message: `Table "${tableId}" is listed twice in this combination`,
        });
      }
      seenMembers.add(tableId);

      // A combination outliving its tables is the orphan case that makes
      // assignment return tables that no longer exist.
      if (!tableIdsInPayload.has(tableId)) {
        issues.push({
          combinationLabel: combo.label,
          field: "tableIds",
          message: `Combination references table "${tableId}", which is not in the submitted floor plan. Send every room whose tables a combination uses.`,
        });
      }
    }
  }

  return issues;
}
