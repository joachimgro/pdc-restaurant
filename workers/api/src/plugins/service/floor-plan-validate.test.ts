import type { DiningTable, FloorPlan, Room } from "@lead-intake/shared-types";
import { describe, expect, it } from "vitest";
import { validateFloorPlan } from "./floor-plan-validate";

function table(overrides: Partial<DiningTable> = {}): DiningTable {
  return {
    id: overrides.label ? `tbl-${overrides.label}` : "tbl-1",
    label: "1",
    seatsMin: 2,
    seatsMax: 4,
    shape: "round",
    posX: 100,
    posY: 100,
    width: 90,
    height: 90,
    rotation: 0,
    onlineBookable: true,
    assignPriority: 100,
    isActive: true,
    notes: null,
    ...overrides,
  };
}

function room(overrides: Partial<Room> = {}): Room {
  return {
    id: "room-main",
    name: "Main Dining",
    accentColor: null,
    onlineBookable: true,
    canvasWidth: 1200,
    canvasHeight: 800,
    sortOrder: 0,
    isActive: true,
    tables: [table()],
    ...overrides,
  };
}

function plan(overrides: Partial<FloorPlan> = {}): FloorPlan {
  return { rooms: [room()], combinations: [], ...overrides };
}

describe("validateFloorPlan", () => {
  it("accepts a well-formed plan", () => {
    expect(validateFloorPlan(plan())).toEqual([]);
  });

  it("rejects duplicate table labels across rooms", () => {
    const issues = validateFloorPlan(
      plan({
        rooms: [
          room({ id: "room-a", tables: [table({ id: "tbl-a", label: "5" })] }),
          room({ id: "room-b", tables: [table({ id: "tbl-b", label: "5" })] }),
        ],
      })
    );
    expect(issues).toHaveLength(1);
    expect(issues[0].field).toBe("label");
    expect(issues[0].tableLabel).toBe("5");
    expect(issues[0].message).toContain("room-a");
  });

  it("rejects seatsMin greater than seatsMax", () => {
    const issues = validateFloorPlan(
      plan({ rooms: [room({ tables: [table({ seatsMin: 6, seatsMax: 4 })] })] })
    );
    expect(issues).toHaveLength(1);
    expect(issues[0].field).toBe("seatsMin");
  });

  it("rejects a table hanging off the canvas rather than clamping it", () => {
    const issues = validateFloorPlan(
      plan({
        rooms: [
          room({
            canvasWidth: 1200,
            tables: [table({ posX: 1150, width: 90 })],
          }),
        ],
      })
    );
    expect(issues).toHaveLength(1);
    expect(issues[0].field).toBe("posX");
    expect(issues[0].message).toContain("1240");
  });

  it("rejects negative coordinates", () => {
    const issues = validateFloorPlan(
      plan({ rooms: [room({ tables: [table({ posX: -10 })] })] })
    );
    expect(issues.some((i) => i.field === "posX")).toBe(true);
  });

  it("rejects an out-of-range rotation", () => {
    const issues = validateFloorPlan(
      plan({ rooms: [room({ tables: [table({ rotation: 360 })] })] })
    );
    expect(issues).toHaveLength(1);
    expect(issues[0].field).toBe("rotation");
  });

  it("rejects a combination referencing a table not in the payload", () => {
    const issues = validateFloorPlan(
      plan({
        combinations: [
          {
            id: "combo-1",
            label: "1+2",
            seatsMin: 5,
            seatsMax: 8,
            assignPriority: 300,
            onlineBookable: true,
            isActive: true,
            tableIds: ["tbl-1", "tbl-missing"],
          },
        ],
      })
    );
    expect(issues).toHaveLength(1);
    expect(issues[0].field).toBe("tableIds");
    expect(issues[0].message).toContain("tbl-missing");
  });

  it("accepts a combination whose members are all present", () => {
    const issues = validateFloorPlan(
      plan({
        rooms: [
          room({
            tables: [table({ label: "1" }), table({ label: "2" })],
          }),
        ],
        combinations: [
          {
            id: "combo-1",
            label: "1+2",
            seatsMin: 5,
            seatsMax: 8,
            assignPriority: 300,
            onlineBookable: true,
            isActive: true,
            tableIds: ["tbl-1", "tbl-2"],
          },
        ],
      })
    );
    expect(issues).toEqual([]);
  });

  it("reports every failing table, not just the first", () => {
    const issues = validateFloorPlan(
      plan({
        rooms: [
          room({
            tables: [
              table({ label: "1", seatsMin: 9, seatsMax: 2 }),
              table({ label: "2", rotation: 400 }),
            ],
          }),
        ],
      })
    );
    expect(issues).toHaveLength(2);
    expect(issues.map((i) => i.tableLabel)).toEqual(["1", "2"]);
  });
});
