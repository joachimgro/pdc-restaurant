import {
  FloorPlanSchema,
  validateFloorPlan,
  type FloorPlan,
  type FloorPlanIssue,
} from "@lead-intake/shared-types";
import { docToFloorPlan } from "./normalise";
import type { Doc, NormalisedIssue, SaveOutcome } from "./types";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787";

export async function fetchFloorPlan(): Promise<FloorPlan> {
  const res = await fetch(`${API_URL}/service/floor-plan`, {
    cache: "no-store",
    credentials: "include",
  });
  if (!res.ok) {
    throw new Error(
      res.status === 403
        ? "You do not have permission to view the floor plan."
        : `Could not load the floor plan (${res.status}).`
    );
  }
  return FloorPlanSchema.parse(await res.json());
}

/**
 * Save the whole plan.
 *
 * Nothing is optimistic. On success the response body is the canonical plan,
 * so the caller rebases the editor onto it in one step; on failure the caller's
 * document is untouched and stays dirty. No edit is ever lost to a rejected
 * save.
 */
export async function saveFloorPlan(
  doc: Doc
): Promise<SaveOutcome & { plan?: FloorPlan }> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}/service/floor-plan`, {
      method: "PUT",
      cache: "no-store",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(docToFloorPlan(doc)),
    });
  } catch {
    return {
      ok: false,
      kind: "network",
      message: "Could not reach the server. Nothing was saved — your layout is still here.",
    };
  }

  if (res.ok) {
    return { ok: true, plan: FloorPlanSchema.parse(await res.json()) };
  }

  if (res.status === 401 || res.status === 403) {
    return {
      ok: false,
      kind: "permission",
      message:
        "You do not have permission to change the floor plan. Nothing was saved.",
    };
  }

  const body = (await res.json().catch(() => null)) as {
    error?: string;
    code?: string;
    details?: unknown;
  } | null;

  const issues = mapServerIssues(body?.details, doc);
  if (issues.length > 0) {
    return { ok: false, kind: "validation", issues };
  }

  return {
    ok: false,
    kind: "network",
    message: body?.error ?? `The save failed (${res.status}). Nothing was saved.`,
  };
}

/**
 * `INVALID_FLOOR_PLAN` carries two different `details` shapes: Zod's issues
 * when the schema parse fails, and FloorPlanIssue[] when the semantic
 * validator fails. Both arrive under the same code, so detect rather than
 * assume.
 */
export function mapServerIssues(details: unknown, doc: Doc): NormalisedIssue[] {
  if (!Array.isArray(details)) return [];

  return details.flatMap((raw): NormalisedIssue[] => {
    if (!raw || typeof raw !== "object") return [];

    // FloorPlanIssue — the semantic validator.
    if ("field" in raw && typeof (raw as FloorPlanIssue).field === "string") {
      const issue = raw as FloorPlanIssue;
      return [
        {
          ...resolveTarget(doc, issue.roomId ?? null, issue.tableLabel ?? null),
          source: "server",
          tableLabel: issue.tableLabel ?? null,
          combinationLabel: issue.combinationLabel ?? null,
          field: issue.field,
          message: issue.message,
        },
      ];
    }

    // Zod issue — path is like ["rooms", 0, "tables", 3, "seatsMax"].
    if ("message" in raw && "path" in raw) {
      const zod = raw as { message: string; path: (string | number)[] };
      const target = resolveZodPath(doc, zod.path);
      return [
        {
          ...target,
          source: "server",
          tableLabel: target.tableId
            ? (doc.tables[target.tableId]?.label ?? null)
            : null,
          combinationLabel: null,
          field: lastStringSegment(zod.path),
          message: `${zod.message}${
            zod.path.length ? ` (${zod.path.join(" → ")})` : ""
          }`,
        },
      ];
    }

    return [];
  });
}

/**
 * The server names tables by label, because that is what its UNIQUE
 * constraint speaks. Selecting one needs an id, so resolve it here — and
 * fall back to the room when the label matches nothing, rather than dropping
 * the issue on the floor.
 */
function resolveTarget(
  doc: Doc,
  roomId: string | null,
  tableLabel: string | null
): { roomId: string | null; tableId: string | null } {
  if (tableLabel) {
    const match = Object.values(doc.tables).find((t) => t.label === tableLabel);
    if (match) return { roomId: match.roomId, tableId: match.id };
  }
  return { roomId: roomId && doc.rooms[roomId] ? roomId : null, tableId: null };
}

function resolveZodPath(
  doc: Doc,
  path: (string | number)[]
): { roomId: string | null; tableId: string | null } {
  // Indices in the payload map back through the same ordering docToFloorPlan used.
  if (path[0] !== "rooms" || typeof path[1] !== "number") {
    return { roomId: null, tableId: null };
  }
  const plan = docToFloorPlan(doc);
  const room = plan.rooms[path[1]];
  if (!room) return { roomId: null, tableId: null };
  if (path[2] === "tables" && typeof path[3] === "number") {
    const table = room.tables[path[3]];
    return { roomId: room.id, tableId: table?.id ?? null };
  }
  return { roomId: room.id, tableId: null };
}

function lastStringSegment(path: (string | number)[]): string | null {
  for (let i = path.length - 1; i >= 0; i--) {
    if (typeof path[i] === "string") return path[i] as string;
  }
  return null;
}

/**
 * Client-side pass, using the same validator the Worker runs. Catching these
 * before the PUT is a speed feature, not a security one — `saveFloorPlan` on
 * the server remains authoritative.
 */
export function validateDoc(doc: Doc): NormalisedIssue[] {
  return validateFloorPlan(docToFloorPlan(doc)).map((issue) => ({
    ...resolveTarget(doc, issue.roomId ?? null, issue.tableLabel ?? null),
    source: "client" as const,
    tableLabel: issue.tableLabel ?? null,
    combinationLabel: issue.combinationLabel ?? null,
    field: issue.field,
    message: issue.message,
  }));
}
