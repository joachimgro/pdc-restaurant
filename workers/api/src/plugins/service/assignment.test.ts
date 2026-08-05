import type { TableCombination } from "@lead-intake/shared-types";
import { describe, expect, it } from "vitest";
import { assignTables, type AssignableTable } from "./assignment";

/**
 * Written against the cases listed in spec §18, not against the
 * implementation. Every test names the property it protects.
 */

function table(
  label: string,
  seatsMin: number,
  seatsMax: number,
  overrides: Partial<AssignableTable> = {}
): AssignableTable {
  return {
    id: `tbl-${label}`,
    label,
    seatsMin,
    seatsMax,
    shape: "square",
    posX: 0,
    posY: 0,
    width: 100,
    height: 100,
    rotation: 0,
    onlineBookable: true,
    assignPriority: 100,
    isActive: true,
    notes: null,
    roomId: "room-main",
    ...overrides,
  };
}

function combo(
  label: string,
  tableIds: string[],
  seatsMin: number,
  seatsMax: number,
  overrides: Partial<TableCombination> = {}
): TableCombination {
  return {
    id: `combo-${label}`,
    label,
    seatsMin,
    seatsMax,
    assignPriority: 100,
    onlineBookable: true,
    isActive: true,
    tableIds,
    ...overrides,
  };
}

const staff = { channel: "staff", reserveLargeTables: false } as const;
const online = { channel: "online", reserveLargeTables: true } as const;

describe("assignTables", () => {
  it("picks the tightest fit", () => {
    const tables = [
      table("1", 2, 8),
      table("2", 2, 4),
      table("3", 2, 6),
    ];
    const result = assignTables(tables, [], 4, staff);
    expect(result?.tableIds).toEqual(["tbl-2"]);
  });

  it("prefers a single table over a combination that fits equally well", () => {
    const tables = [
      table("1", 2, 6),
      table("2", 2, 4),
      table("3", 2, 4),
    ];
    const combinations = [combo("2+3", ["tbl-2", "tbl-3"], 4, 6)];

    const result = assignTables(tables, combinations, 6, staff);
    expect(result?.combinationId).toBeNull();
    expect(result?.tableIds).toEqual(["tbl-1"]);
  });

  it("prefers a two-table combination over a three-table one", () => {
    const tables = [
      table("1", 2, 4),
      table("2", 2, 4),
      table("3", 2, 4),
    ];
    const combinations = [
      combo("1+2+3", ["tbl-1", "tbl-2", "tbl-3"], 6, 8),
      combo("1+2", ["tbl-1", "tbl-2"], 6, 8),
    ];

    const result = assignTables(tables, combinations, 8, staff);
    expect(result?.combinationId).toBe("combo-1+2");
  });

  it("penalises the eight-top for online but not for staff", () => {
    const tables = [table("8top", 2, 8)];

    const onlineResult = assignTables(tables, [], 2, online);
    const staffResult = assignTables(tables, [], 2, staff);

    // Same table either way when it is the only one — the difference is
    // exactly the reserve-large-tables penalty, nothing else.
    expect(onlineResult?.tableIds).toEqual(["tbl-8top"]);
    expect(staffResult?.tableIds).toEqual(["tbl-8top"]);
    expect(onlineResult!.score - staffResult!.score).toBe(60);
  });

  it("passes over the eight-top for online when a four-top exists", () => {
    const tables = [table("8top", 2, 8), table("4top", 2, 4)];
    const result = assignTables(tables, [], 2, online);
    expect(result?.tableIds).toEqual(["tbl-4top"]);
  });

  it("releases the eight-top for a staff walk-in when it is the best fit", () => {
    // A 2-top and an 8-top, party of 6: only the 8-top fits, and staff get it
    // without the online channel's reservation penalty standing in the way.
    const tables = [table("2top", 1, 2), table("8top", 4, 8)];
    const result = assignTables(tables, [], 6, staff);
    expect(result?.tableIds).toEqual(["tbl-8top"]);
  });

  it("respects room preference when an otherwise equal alternative exists", () => {
    const tables = [
      table("1", 2, 4, { roomId: "room-bar" }),
      table("2", 2, 4, { roomId: "room-terrace" }),
    ];

    const result = assignTables(tables, [], 4, {
      ...staff,
      preferredRoomIds: ["room-terrace"],
    });
    expect(result?.tableIds).toEqual(["tbl-2"]);
  });

  it("still returns a table outside the preferred room when nothing else fits", () => {
    const tables = [table("1", 2, 4, { roomId: "room-bar" })];
    const result = assignTables(tables, [], 4, {
      ...staff,
      preferredRoomIds: ["room-terrace"],
    });
    expect(result?.tableIds).toEqual(["tbl-1"]);
  });

  it("breaks ties by label, ascending and numerically", () => {
    // Identical in every scoring input; only the label separates them.
    const tables = [table("10", 2, 4), table("2", 2, 4), table("7", 2, 4)];
    const result = assignTables(tables, [], 4, staff);
    expect(result?.tableIds).toEqual(["tbl-2"]);
  });

  it("is deterministic regardless of input ordering", () => {
    const tables = [table("10", 2, 4), table("2", 2, 4), table("7", 2, 4)];
    const forwards = assignTables(tables, [], 4, staff);
    const backwards = assignTables([...tables].reverse(), [], 4, staff);
    expect(forwards).toEqual(backwards);
  });

  it("returns null when nothing fits", () => {
    const tables = [table("1", 2, 4)];
    expect(assignTables(tables, [], 10, staff)).toBeNull();
  });

  it("returns null for a party below the smallest table minimum", () => {
    const tables = [table("1", 4, 8)];
    expect(assignTables(tables, [], 2, staff)).toBeNull();
  });

  it("never returns an inactive table", () => {
    const tables = [table("1", 2, 4, { isActive: false })];
    expect(assignTables(tables, [], 4, staff)).toBeNull();
  });

  it("never returns a non-online-bookable table on the online channel", () => {
    const tables = [table("1", 2, 4, { onlineBookable: false })];
    expect(assignTables(tables, [], 4, online)).toBeNull();
    // Staff may still seat it.
    expect(assignTables(tables, [], 4, staff)?.tableIds).toEqual(["tbl-1"]);
  });

  it("rejects a combination whose member is not free", () => {
    // tbl-2 is absent from the free set, so the combination cannot be used.
    const tables = [table("1", 2, 4)];
    const combinations = [combo("1+2", ["tbl-1", "tbl-2"], 6, 8)];
    expect(assignTables(tables, combinations, 8, staff)).toBeNull();
  });

  it("rejects a combination whose member is off the online channel", () => {
    const tables = [
      table("1", 2, 4),
      table("2", 2, 4, { onlineBookable: false }),
    ];
    const combinations = [combo("1+2", ["tbl-1", "tbl-2"], 6, 8)];

    // A combination flag cannot re-sell a table the manager took offline.
    expect(assignTables(tables, combinations, 8, online)).toBeNull();
    expect(assignTables(tables, combinations, 8, staff)?.combinationId).toBe(
      "combo-1+2"
    );
  });

  it("ignores an inactive combination", () => {
    const tables = [table("1", 2, 4), table("2", 2, 4)];
    const combinations = [
      combo("1+2", ["tbl-1", "tbl-2"], 6, 8, { isActive: false }),
    ];
    expect(assignTables(tables, combinations, 8, staff)).toBeNull();
  });

  it("uses assign priority to separate otherwise equal tables", () => {
    const tables = [
      table("1", 2, 4, { assignPriority: 900 }),
      table("2", 2, 4, { assignPriority: 100 }),
    ];
    const result = assignTables(tables, [], 4, staff);
    expect(result?.tableIds).toEqual(["tbl-2"]);
  });

  it("reports the seats and combination id of the winning candidate", () => {
    const tables = [table("1", 2, 4), table("2", 2, 4)];
    const combinations = [combo("1+2", ["tbl-1", "tbl-2"], 6, 8)];
    const result = assignTables(tables, combinations, 7, staff);

    expect(result).toMatchObject({
      combinationId: "combo-1+2",
      seatsTotal: 8,
    });
    expect(result?.tableIds).toHaveLength(2);
  });
});
