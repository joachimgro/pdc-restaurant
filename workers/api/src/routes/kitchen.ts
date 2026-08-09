import { z } from "zod";
import { jsonResponse } from "../cors";
import { getDefaultLocation } from "../db/locations";
import { getStaffSession, type StaffSession } from "../auth/session";
import {
  createKitchenTicket,
  createMenuCategory,
  createMenuItem,
  deactivateMenuItem,
  getKitchenMenu,
  importKitchenMenu,
  listKitchenTickets,
  reorderKitchenMenu,
  updateKitchenTicketStatus,
  type KitchenTicketStatus,
} from "../plugins/kitchen/db";
import { parseMenuImport } from "../plugins/kitchen/menu-import";
import { parseMenuFromImage } from "../plugins/kitchen/menu-from-image";
import type { Env } from "../env";

const INVALID = Symbol("invalid-json");

const CreateTicketSchema = z.object({
  station: z.string().min(1),
  tableLabel: z.string().nullable().optional(),
  reservationId: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  items: z
    .array(
      z.object({
        menuItemId: z.string().min(1),
        qty: z.number().int().positive(),
        notes: z.string().nullable().optional(),
      })
    )
    .min(1),
});

const TicketStatusSchema = z.object({
  status: z.enum(["in_progress", "ready", "served", "void"]),
});

const CreateCategorySchema = z.object({
  name: z.string().min(1).max(80),
  station: z.string().min(1).max(40).optional(),
});

const CreateItemSchema = z.object({
  categoryId: z.string().min(1),
  name: z.string().min(1).max(120),
  pricePence: z.number().int().min(0).optional(),
  station: z.string().min(1).max(40).optional(),
  description: z.string().max(500).nullable().optional(),
});

const ImportMenuSchema = z.object({
  mode: z.enum(["replace", "merge"]).default("merge"),
  categories: z
    .array(
      z.object({
        name: z.string().min(1),
        station: z.string().min(1).default("restaurant"),
        items: z.array(
          z.object({
            name: z.string().min(1),
            description: z.string().nullable().optional(),
            pricePence: z.number().int().min(0).optional(),
            station: z.string().nullable().optional(),
          })
        ),
      })
    )
    .optional(),
  text: z.string().min(1).optional(),
});

const ReorderMenuSchema = z.object({
  categories: z
    .array(
      z.object({
        id: z.string().min(1),
        sortOrder: z.number().int(),
        station: z.string().min(1).optional(),
      })
    )
    .optional(),
  items: z
    .array(
      z.object({
        id: z.string().min(1),
        sortOrder: z.number().int(),
        categoryId: z.string().min(1).optional(),
      })
    )
    .optional(),
});

function kitchenError(
  request: Request,
  env: Env,
  status: number,
  code: string,
  error: string,
  details?: unknown
): Response {
  return jsonResponse(
    request,
    env,
    details === undefined ? { error, code } : { error, code, details },
    status
  );
}

async function requireSession(
  request: Request,
  env: Env
): Promise<StaffSession | Response> {
  const session = await getStaffSession(env, request);
  if (!session) {
    return kitchenError(request, env, 401, "UNAUTHORIZED", "Unauthorized");
  }
  return session;
}

async function resolveLocationId(
  request: Request,
  env: Env
): Promise<string | null> {
  const explicit = new URL(request.url).searchParams.get("locationId");
  if (explicit) {
    const row = await env.DB.prepare(
      `SELECT id FROM locations WHERE id = ? AND organization_id = ?`
    )
      .bind(explicit, env.ORGANIZATION_ID)
      .first<{ id: string }>();
    return row?.id ?? null;
  }
  const location = await getDefaultLocation(env);
  return location?.id ?? null;
}

async function readJson(request: Request): Promise<unknown | typeof INVALID> {
  try {
    return await request.json();
  } catch {
    return INVALID;
  }
}

/** GET /kitchen/menu */
export async function handleGetKitchenMenu(
  request: Request,
  env: Env
): Promise<Response> {
  const session = await requireSession(request, env);
  if (session instanceof Response) return session;

  const locationId = await resolveLocationId(request, env);
  if (!locationId) {
    return kitchenError(request, env, 404, "NO_LOCATION", "No location configured");
  }

  const menu = await getKitchenMenu(env, locationId);
  return jsonResponse(request, env, { categories: menu });
}

/** POST /kitchen/menu/parse-image — multipart file or JSON { imageBase64 } */
export async function handleParseMenuImage(
  request: Request,
  env: Env
): Promise<Response> {
  const session = await requireSession(request, env);
  if (session instanceof Response) return session;

  const locationId = await resolveLocationId(request, env);
  if (!locationId) {
    return kitchenError(request, env, 404, "NO_LOCATION", "No location configured");
  }

  let bytes: Uint8Array | null = null;
  const contentType = request.headers.get("content-type") ?? "";

  try {
    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      const file = form.get("image") ?? form.get("file");
      if (
        file &&
        typeof file === "object" &&
        "arrayBuffer" in file &&
        typeof (file as Blob).arrayBuffer === "function"
      ) {
        bytes = new Uint8Array(await (file as Blob).arrayBuffer());
      }
    } else {
      const body = await readJson(request);
      if (body === INVALID) {
        return kitchenError(request, env, 400, "INVALID_JSON", "Invalid JSON");
      }
      const raw = (body as { imageBase64?: string }).imageBase64;
      if (typeof raw === "string" && raw.length > 0) {
        const cleaned = raw.replace(/^data:[^;]+;base64,/, "");
        const bin = atob(cleaned);
        bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      }
    }
  } catch {
    return kitchenError(
      request,
      env,
      400,
      "INVALID_IMAGE",
      "Could not read the uploaded image"
    );
  }

  if (!bytes || bytes.byteLength === 0) {
    return kitchenError(
      request,
      env,
      400,
      "MISSING_IMAGE",
      "Upload an image file (field name: image) or imageBase64"
    );
  }

  try {
    const parsed = await parseMenuFromImage(env, bytes);
    return jsonResponse(request, env, {
      text: parsed.text,
      categories: parsed.categories,
      itemCount: parsed.categories.reduce((n, c) => n + c.items.length, 0),
      categoryCount: parsed.categories.length,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to parse menu from image";
    const code =
      message.includes("AI is not enabled") ? "AI_DISABLED" : "PARSE_FAILED";
    return kitchenError(
      request,
      env,
      code === "AI_DISABLED" ? 503 : 422,
      code,
      message
    );
  }
}

/** POST /kitchen/menu/import */
export async function handleImportKitchenMenu(
  request: Request,
  env: Env
): Promise<Response> {
  const session = await requireSession(request, env);
  if (session instanceof Response) return session;

  const locationId = await resolveLocationId(request, env);
  if (!locationId) {
    return kitchenError(request, env, 404, "NO_LOCATION", "No location configured");
  }

  const body = await readJson(request);
  if (body === INVALID) {
    return kitchenError(request, env, 400, "INVALID_JSON", "Invalid JSON");
  }

  const parsed = ImportMenuSchema.safeParse(body);
  if (!parsed.success) {
    return kitchenError(
      request,
      env,
      400,
      "INVALID_IMPORT",
      "Import failed validation",
      parsed.error.issues
    );
  }

  let categories = parsed.data.categories?.map((c) => ({
    name: c.name,
    station: c.station,
    items: c.items.map((i) => ({
      name: i.name,
      description: i.description ?? null,
      pricePence: i.pricePence ?? 0,
      station: i.station ?? null,
    })),
  }));

  if ((!categories || categories.length === 0) && parsed.data.text) {
    try {
      categories = parseMenuImport(parsed.data.text);
    } catch (err) {
      return kitchenError(
        request,
        env,
        400,
        "INVALID_IMPORT",
        err instanceof Error ? err.message : "Could not parse menu text"
      );
    }
  }

  if (!categories || categories.length === 0) {
    return kitchenError(
      request,
      env,
      400,
      "EMPTY_IMPORT",
      "No categories or items found to import"
    );
  }

  const menu = await importKitchenMenu(env, locationId, {
    mode: parsed.data.mode,
    categories,
  });

  return jsonResponse(request, env, {
    categories: menu,
    importedCategories: categories.length,
    importedItems: categories.reduce((n, c) => n + c.items.length, 0),
  });
}

/** POST /kitchen/menu/categories */
export async function handleCreateMenuCategory(
  request: Request,
  env: Env
): Promise<Response> {
  const session = await requireSession(request, env);
  if (session instanceof Response) return session;

  const locationId = await resolveLocationId(request, env);
  if (!locationId) {
    return kitchenError(request, env, 404, "NO_LOCATION", "No location configured");
  }

  const body = await readJson(request);
  if (body === INVALID) {
    return kitchenError(request, env, 400, "INVALID_JSON", "Invalid JSON");
  }

  const parsed = CreateCategorySchema.safeParse(body);
  if (!parsed.success) {
    return kitchenError(
      request,
      env,
      400,
      "INVALID_CATEGORY",
      "Category failed validation",
      parsed.error.issues
    );
  }

  const category = await createMenuCategory(env, locationId, parsed.data);
  return jsonResponse(request, env, { category }, 201);
}

/** POST /kitchen/menu/items */
export async function handleCreateMenuItem(
  request: Request,
  env: Env
): Promise<Response> {
  const session = await requireSession(request, env);
  if (session instanceof Response) return session;

  const locationId = await resolveLocationId(request, env);
  if (!locationId) {
    return kitchenError(request, env, 404, "NO_LOCATION", "No location configured");
  }

  const body = await readJson(request);
  if (body === INVALID) {
    return kitchenError(request, env, 400, "INVALID_JSON", "Invalid JSON");
  }

  const parsed = CreateItemSchema.safeParse(body);
  if (!parsed.success) {
    return kitchenError(
      request,
      env,
      400,
      "INVALID_ITEM",
      "Item failed validation",
      parsed.error.issues
    );
  }

  const item = await createMenuItem(env, locationId, parsed.data);
  if (!item) {
    return kitchenError(request, env, 404, "NOT_FOUND", "Category not found");
  }
  return jsonResponse(request, env, { item }, 201);
}

/** DELETE /kitchen/menu/items/:id */
export async function handleDeleteMenuItem(
  request: Request,
  env: Env,
  itemId: string
): Promise<Response> {
  const session = await requireSession(request, env);
  if (session instanceof Response) return session;

  const locationId = await resolveLocationId(request, env);
  if (!locationId) {
    return kitchenError(request, env, 404, "NO_LOCATION", "No location configured");
  }

  const ok = await deactivateMenuItem(env, locationId, itemId);
  if (!ok) {
    return kitchenError(request, env, 404, "NOT_FOUND", "Menu item not found");
  }
  return jsonResponse(request, env, { ok: true });
}

/** PUT /kitchen/menu/reorder */
export async function handleReorderKitchenMenu(
  request: Request,
  env: Env
): Promise<Response> {
  const session = await requireSession(request, env);
  if (session instanceof Response) return session;

  const locationId = await resolveLocationId(request, env);
  if (!locationId) {
    return kitchenError(request, env, 404, "NO_LOCATION", "No location configured");
  }

  const body = await readJson(request);
  if (body === INVALID) {
    return kitchenError(request, env, 400, "INVALID_JSON", "Invalid JSON");
  }

  const parsed = ReorderMenuSchema.safeParse(body);
  if (!parsed.success) {
    return kitchenError(
      request,
      env,
      400,
      "INVALID_REORDER",
      "Reorder failed validation",
      parsed.error.issues
    );
  }

  if (
    (parsed.data.categories?.length ?? 0) === 0 &&
    (parsed.data.items?.length ?? 0) === 0
  ) {
    return kitchenError(request, env, 400, "EMPTY_REORDER", "Nothing to reorder");
  }

  const categories = await reorderKitchenMenu(env, locationId, parsed.data);
  return jsonResponse(request, env, { categories });
}

/** GET /kitchen/tickets?station=&status= */
export async function handleListKitchenTickets(
  request: Request,
  env: Env
): Promise<Response> {
  const session = await requireSession(request, env);
  if (session instanceof Response) return session;

  const locationId = await resolveLocationId(request, env);
  if (!locationId) {
    return kitchenError(request, env, 404, "NO_LOCATION", "No location configured");
  }

  const url = new URL(request.url);
  const station = url.searchParams.get("station");
  const status = url.searchParams.get("status");

  const tickets = await listKitchenTickets(
    env,
    locationId,
    station || null,
    status || null
  );
  return jsonResponse(request, env, { tickets });
}

/** POST /kitchen/tickets */
export async function handleCreateKitchenTicket(
  request: Request,
  env: Env
): Promise<Response> {
  const session = await requireSession(request, env);
  if (session instanceof Response) return session;

  const locationId = await resolveLocationId(request, env);
  if (!locationId) {
    return kitchenError(request, env, 404, "NO_LOCATION", "No location configured");
  }

  const body = await readJson(request);
  if (body === INVALID) {
    return kitchenError(request, env, 400, "INVALID_JSON", "Invalid JSON");
  }

  const parsed = CreateTicketSchema.safeParse(body);
  if (!parsed.success) {
    return kitchenError(
      request,
      env,
      400,
      "INVALID_TICKET",
      "Ticket failed validation",
      parsed.error.issues
    );
  }

  const ticket = await createKitchenTicket(env, locationId, {
    ...parsed.data,
    createdByStaffId: session.row.id,
  });

  if (!ticket) {
    return kitchenError(
      request,
      env,
      400,
      "INVALID_MENU_ITEM",
      "One or more menu items were not found"
    );
  }

  return jsonResponse(request, env, ticket, 201);
}

/** POST /kitchen/tickets/:id/status */
export async function handleKitchenTicketStatus(
  request: Request,
  env: Env,
  ticketId: string
): Promise<Response> {
  const session = await requireSession(request, env);
  if (session instanceof Response) return session;

  const locationId = await resolveLocationId(request, env);
  if (!locationId) {
    return kitchenError(request, env, 404, "NO_LOCATION", "No location configured");
  }

  const body = await readJson(request);
  if (body === INVALID) {
    return kitchenError(request, env, 400, "INVALID_JSON", "Invalid JSON");
  }

  const parsed = TicketStatusSchema.safeParse(body);
  if (!parsed.success) {
    return kitchenError(
      request,
      env,
      400,
      "INVALID_STATUS",
      "status must be in_progress, ready, served, or void"
    );
  }

  const ticket = await updateKitchenTicketStatus(
    env,
    locationId,
    ticketId,
    parsed.data.status as KitchenTicketStatus
  );

  if (!ticket) {
    return kitchenError(request, env, 404, "NOT_FOUND", "Ticket not found");
  }

  return jsonResponse(request, env, ticket);
}
