import type { DiningTable, TableCombination } from "@lead-intake/shared-types";

/**
 * Table assignment engine. PURE — no database, no clock, no environment.
 * Load the free-table set in the caller and pass it in.
 *
 * Determinism is the requirement that makes everything else possible: the same
 * input must give the same output every time, or the suite cannot assert
 * anything and staff learn not to trust the suggestion.
 */

/** A table plus the room it sits in, which room preference scoring needs. */
export type AssignableTable = DiningTable & { roomId: string };

export interface TableAssignment {
  tableIds: string[];
  combinationId: string | null;
  seatsTotal: number;
  score: number;
}

export interface AssignOptions {
  channel: "online" | "staff";
  preferredRoomIds?: string[];
  reserveLargeTables: boolean;
}

/** Penalty applied to a table outside the guest's preferred room. */
const ROOM_MISMATCH_PENALTY = 40;
/** Penalty for burning a much larger table than the party needs. */
const LARGE_TABLE_PENALTY = 60;
/** Flat penalty on every combination — a single table is always nicer. */
const COMBINATION_PENALTY = 100;
/** Additional penalty per member beyond two. */
const EXTRA_MEMBER_PENALTY = 25;
/** A table this many seats above the party counts as "large". */
const LARGE_TABLE_MARGIN = 3;

type Candidate = TableAssignment & { tieBreak: string };

/**
 * Natural-order label compare, so table "2" sorts before "10".
 * Plain string compare would put "10" first and make the tie-break look
 * arbitrary to anyone reading the floor plan.
 */
function compareLabels(a: string, b: string): number {
  return a.localeCompare(b, "en", { numeric: true, sensitivity: "base" });
}

function tableUsable(
  table: AssignableTable,
  channel: "online" | "staff"
): boolean {
  if (!table.isActive) return false;
  return channel === "staff" || table.onlineBookable;
}

export function assignTables(
  freeTables: AssignableTable[],
  combinations: TableCombination[],
  partySize: number,
  opts: AssignOptions
): TableAssignment | null {
  if (partySize < 1) return null;

  // Sorted defensively so the caller's ordering can never leak into the
  // result. Determinism must not depend on how the rows came back from D1.
  const tables = [...freeTables].sort((a, b) => compareLabels(a.label, b.label));
  const freeById = new Map(tables.map((t) => [t.id, t]));

  const candidates: Candidate[] = [];

  for (const table of tables) {
    if (!tableUsable(table, opts.channel)) continue;
    if (partySize < table.seatsMin || partySize > table.seatsMax) continue;

    let score = (table.seatsMax - partySize) * 10 + table.assignPriority / 10;

    if (opts.preferredRoomIds && opts.preferredRoomIds.length > 0) {
      if (!opts.preferredRoomIds.includes(table.roomId)) {
        score += ROOM_MISMATCH_PENALTY;
      }
    }

    if (opts.reserveLargeTables && table.seatsMax >= partySize + LARGE_TABLE_MARGIN) {
      score += LARGE_TABLE_PENALTY;
    }

    candidates.push({
      tableIds: [table.id],
      combinationId: null,
      seatsTotal: table.seatsMax,
      score,
      tieBreak: table.label,
    });
  }

  const sortedCombinations = [...combinations].sort((a, b) =>
    compareLabels(a.label, b.label)
  );

  for (const combo of sortedCombinations) {
    if (!combo.isActive) continue;
    if (opts.channel === "online" && !combo.onlineBookable) continue;
    if (partySize < combo.seatsMin || partySize > combo.seatsMax) continue;
    if (combo.tableIds.length < 2) continue;

    const members = combo.tableIds.map((id) => freeById.get(id));
    // Every member must be free, and on the online channel every member must
    // itself be sellable online — a combination flag cannot override a table
    // the manager took off the online channel.
    if (members.some((m) => !m || !tableUsable(m, opts.channel))) continue;

    const memberTables = members as AssignableTable[];

    let score =
      (combo.seatsMax - partySize) * 10 +
      combo.assignPriority / 10 +
      COMBINATION_PENALTY +
      (memberTables.length - 2) * EXTRA_MEMBER_PENALTY;

    if (opts.preferredRoomIds && opts.preferredRoomIds.length > 0) {
      const anyOutside = memberTables.some(
        (m) => !opts.preferredRoomIds?.includes(m.roomId)
      );
      if (anyOutside) score += ROOM_MISMATCH_PENALTY;
    }

    const memberLabels = memberTables
      .map((m) => m.label)
      .sort(compareLabels);

    candidates.push({
      tableIds: memberTables.map((m) => m.id),
      combinationId: combo.id,
      seatsTotal: combo.seatsMax,
      score,
      tieBreak: memberLabels.join("+"),
    });
  }

  if (candidates.length === 0) return null;

  candidates.sort(
    (a, b) => a.score - b.score || compareLabels(a.tieBreak, b.tieBreak)
  );

  const { tieBreak: _tieBreak, ...best } = candidates[0];
  return best;
}
