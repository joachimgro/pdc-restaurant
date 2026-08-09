import type { Env } from "../../env";

export type KitchenMenuCategory = {
  id: string;
  name: string;
  station: string;
  sortOrder: number;
  items: KitchenMenuItem[];
};

export type KitchenMenuItem = {
  id: string;
  categoryId: string;
  name: string;
  description: string | null;
  pricePence: number;
  station: string;
  sortOrder: number;
};

export type KitchenTicketItem = {
  id: string;
  menuItemId: string | null;
  name: string;
  qty: number;
  notes: string | null;
  status: string;
};

export type KitchenTicket = {
  id: string;
  locationId: string;
  reservationId: string | null;
  tableLabel: string | null;
  station: string;
  status: string;
  notes: string | null;
  startedAt: string | null;
  readyAt: string | null;
  servedAt: string | null;
  createdAt: string;
  updatedAt: string;
  items: KitchenTicketItem[];
};

type MenuCategoryRow = {
  id: string;
  name: string;
  station: string;
  sort_order: number;
};

type MenuItemRow = {
  id: string;
  category_id: string;
  name: string;
  description: string | null;
  price_pence: number;
  station: string;
  sort_order: number;
};

type TicketRow = {
  id: string;
  location_id: string;
  reservation_id: string | null;
  table_label: string | null;
  station: string;
  status: string;
  notes: string | null;
  started_at: string | null;
  ready_at: string | null;
  served_at: string | null;
  created_at: string;
  updated_at: string;
};

type TicketItemRow = {
  id: string;
  ticket_id: string;
  menu_item_id: string | null;
  name: string;
  qty: number;
  notes: string | null;
  status: string;
};

export async function getKitchenMenu(
  env: Env,
  locationId: string
): Promise<KitchenMenuCategory[]> {
  const categories = await env.DB.prepare(
    `SELECT id, name, station, sort_order
     FROM menu_categories
     WHERE organization_id = ? AND location_id = ? AND is_active = 1
     ORDER BY sort_order ASC, name ASC`
  )
    .bind(env.ORGANIZATION_ID, locationId)
    .all<MenuCategoryRow>();

  const items = await env.DB.prepare(
    `SELECT id, category_id, name, description, price_pence, station, sort_order
     FROM menu_items
     WHERE organization_id = ? AND location_id = ? AND is_active = 1
     ORDER BY sort_order ASC, name ASC`
  )
    .bind(env.ORGANIZATION_ID, locationId)
    .all<MenuItemRow>();

  const itemsByCategory = new Map<string, KitchenMenuItem[]>();
  for (const row of items.results ?? []) {
    const list = itemsByCategory.get(row.category_id) ?? [];
    list.push({
      id: row.id,
      categoryId: row.category_id,
      name: row.name,
      description: row.description,
      pricePence: row.price_pence,
      station: row.station,
      sortOrder: row.sort_order,
    });
    itemsByCategory.set(row.category_id, list);
  }

  return (categories.results ?? []).map((cat) => ({
    id: cat.id,
    name: cat.name,
    station: cat.station,
    sortOrder: cat.sort_order,
    items: itemsByCategory.get(cat.id) ?? [],
  }));
}

export async function listKitchenTickets(
  env: Env,
  locationId: string,
  station: string | null,
  status: string | null
): Promise<KitchenTicket[]> {
  let query = `SELECT id, location_id, reservation_id, table_label, station, status, notes,
                      started_at, ready_at, served_at, created_at, updated_at
               FROM kitchen_tickets
               WHERE organization_id = ? AND location_id = ?`;
  const binds: string[] = [env.ORGANIZATION_ID, locationId];

  if (station) {
    query += ` AND station = ?`;
    binds.push(station);
  }
  if (status) {
    query += ` AND status = ?`;
    binds.push(status);
  }

  query += ` ORDER BY created_at ASC`;

  const tickets = await env.DB.prepare(query)
    .bind(...binds)
    .all<TicketRow>();

  const ids = (tickets.results ?? []).map((t) => t.id);
  if (ids.length === 0) return [];

  const placeholders = ids.map(() => "?").join(", ");
  const itemRows = await env.DB.prepare(
    `SELECT id, ticket_id, menu_item_id, name, qty, notes, status
     FROM kitchen_ticket_items
     WHERE ticket_id IN (${placeholders})
     ORDER BY created_at ASC`
  )
    .bind(...ids)
    .all<TicketItemRow>();

  const itemsByTicket = new Map<string, KitchenTicketItem[]>();
  for (const row of itemRows.results ?? []) {
    const list = itemsByTicket.get(row.ticket_id) ?? [];
    list.push({
      id: row.id,
      menuItemId: row.menu_item_id,
      name: row.name,
      qty: row.qty,
      notes: row.notes,
      status: row.status,
    });
    itemsByTicket.set(row.ticket_id, list);
  }

  return (tickets.results ?? []).map((row) => ({
    id: row.id,
    locationId: row.location_id,
    reservationId: row.reservation_id,
    tableLabel: row.table_label,
    station: row.station,
    status: row.status,
    notes: row.notes,
    startedAt: row.started_at,
    readyAt: row.ready_at,
    servedAt: row.served_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    items: itemsByTicket.get(row.id) ?? [],
  }));
}

export type CreateKitchenTicketInput = {
  station: string;
  tableLabel?: string | null;
  reservationId?: string | null;
  notes?: string | null;
  items: { menuItemId: string; qty: number; notes?: string | null }[];
  createdByStaffId?: string | null;
};

export async function createKitchenTicket(
  env: Env,
  locationId: string,
  input: CreateKitchenTicketInput
): Promise<KitchenTicket | null> {
  const ticketId = crypto.randomUUID();
  const now = new Date().toISOString();

  const menuRows =
    input.items.length > 0
      ? await env.DB.prepare(
          `SELECT id, name, station
           FROM menu_items
           WHERE organization_id = ? AND location_id = ? AND id IN (${input.items
             .map(() => "?")
             .join(", ")})`
        )
          .bind(
            env.ORGANIZATION_ID,
            locationId,
            ...input.items.map((i) => i.menuItemId)
          )
          .all<{ id: string; name: string; station: string }>()
      : { results: [] as { id: string; name: string; station: string }[] };

  const menuById = new Map(
    (menuRows.results ?? []).map((r) => [r.id, r] as const)
  );

  const stmts: D1PreparedStatement[] = [
    env.DB.prepare(
      `INSERT INTO kitchen_tickets (
         id, organization_id, location_id, reservation_id, table_label,
         station, status, notes, created_by_staff_id, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, 'new', ?, ?, ?, ?)`
    ).bind(
      ticketId,
      env.ORGANIZATION_ID,
      locationId,
      input.reservationId ?? null,
      input.tableLabel ?? null,
      input.station,
      input.notes ?? null,
      input.createdByStaffId ?? null,
      now,
      now
    ),
  ];

  for (const item of input.items) {
    const menu = menuById.get(item.menuItemId);
    if (!menu) return null;
    stmts.push(
      env.DB.prepare(
        `INSERT INTO kitchen_ticket_items (
           id, ticket_id, menu_item_id, name, qty, notes, status, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, 'new', ?, ?)`
      ).bind(
        crypto.randomUUID(),
        ticketId,
        menu.id,
        menu.name,
        item.qty,
        item.notes ?? null,
        now,
        now
      )
    );
  }

  await env.DB.batch(stmts);

  const tickets = await listKitchenTickets(env, locationId, null, null);
  return tickets.find((t) => t.id === ticketId) ?? null;
}

export type KitchenTicketStatus = "in_progress" | "ready" | "served" | "void";

export async function updateKitchenTicketStatus(
  env: Env,
  locationId: string,
  ticketId: string,
  status: KitchenTicketStatus
): Promise<KitchenTicket | null> {
  const existing = await env.DB.prepare(
    `SELECT id FROM kitchen_tickets
     WHERE id = ? AND organization_id = ? AND location_id = ?`
  )
    .bind(ticketId, env.ORGANIZATION_ID, locationId)
    .first<{ id: string }>();

  if (!existing) return null;

  const now = new Date().toISOString();
  const startedAt = status === "in_progress" ? now : null;
  const readyAt = status === "ready" ? now : null;
  const servedAt = status === "served" ? now : null;

  await env.DB.prepare(
    `UPDATE kitchen_tickets
     SET status = ?,
         started_at = COALESCE(started_at, ?),
         ready_at = CASE WHEN ? = 'ready' THEN ? ELSE ready_at END,
         served_at = CASE WHEN ? = 'served' THEN ? ELSE served_at END,
         updated_at = ?
     WHERE id = ? AND organization_id = ? AND location_id = ?`
  )
    .bind(
      status,
      startedAt,
      status,
      readyAt,
      status,
      servedAt,
      now,
      ticketId,
      env.ORGANIZATION_ID,
      locationId
    )
    .run();

  if (status === "void" || status === "served") {
    await env.DB.prepare(
      `UPDATE kitchen_ticket_items SET status = ?, updated_at = ? WHERE ticket_id = ?`
    )
      .bind(status, now, ticketId)
      .run();
  } else if (status === "in_progress") {
    await env.DB.prepare(
      `UPDATE kitchen_ticket_items SET status = 'in_progress', updated_at = ? WHERE ticket_id = ?`
    )
      .bind(now, ticketId)
      .run();
  } else if (status === "ready") {
    await env.DB.prepare(
      `UPDATE kitchen_ticket_items SET status = 'ready', updated_at = ? WHERE ticket_id = ?`
    )
      .bind(now, ticketId)
      .run();
  }

  const tickets = await listKitchenTickets(env, locationId, null, null);
  return tickets.find((t) => t.id === ticketId) ?? null;
}

export type ImportMenuMode = "replace" | "merge";

export type ImportMenuInput = {
  mode: ImportMenuMode;
  categories: {
    name: string;
    station: string;
    items: {
      name: string;
      description: string | null;
      pricePence: number;
      station: string | null;
    }[];
  }[];
};

export async function importKitchenMenu(
  env: Env,
  locationId: string,
  input: ImportMenuInput
): Promise<KitchenMenuCategory[]> {
  const orgId = env.ORGANIZATION_ID;
  const now = new Date().toISOString();

  if (input.mode === "replace") {
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE menu_items SET is_active = 0, updated_at = ?
         WHERE organization_id = ? AND location_id = ?`
      ).bind(now, orgId, locationId),
      env.DB.prepare(
        `UPDATE menu_categories SET is_active = 0, updated_at = ?
         WHERE organization_id = ? AND location_id = ?`
      ).bind(now, orgId, locationId),
    ]);
  }

  let catOrder = 100;
  for (const cat of input.categories) {
    const existingCat =
      input.mode === "merge"
        ? await env.DB.prepare(
            `SELECT id FROM menu_categories
             WHERE organization_id = ? AND location_id = ?
               AND lower(name) = lower(?) AND is_active = 1
             LIMIT 1`
          )
            .bind(orgId, locationId, cat.name)
            .first<{ id: string }>()
        : null;

    const categoryId = existingCat?.id ?? crypto.randomUUID();
    if (!existingCat) {
      await env.DB.prepare(
        `INSERT INTO menu_categories (
           id, organization_id, location_id, name, station, sort_order,
           is_active, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`
      )
        .bind(
          categoryId,
          orgId,
          locationId,
          cat.name,
          cat.station || "restaurant",
          catOrder,
          now,
          now
        )
        .run();
    } else {
      await env.DB.prepare(
        `UPDATE menu_categories
         SET station = ?, updated_at = ?
         WHERE id = ?`
      )
        .bind(cat.station || "restaurant", now, categoryId)
        .run();
    }

    let itemOrder = 100;
    for (const item of cat.items) {
      const station = item.station || cat.station || "restaurant";
      const existingItem =
        input.mode === "merge"
          ? await env.DB.prepare(
              `SELECT id FROM menu_items
               WHERE organization_id = ? AND location_id = ?
                 AND category_id = ? AND lower(name) = lower(?)
                 AND is_active = 1
               LIMIT 1`
            )
              .bind(orgId, locationId, categoryId, item.name)
              .first<{ id: string }>()
          : null;

      if (existingItem) {
        await env.DB.prepare(
          `UPDATE menu_items
           SET description = ?, price_pence = ?, station = ?, updated_at = ?
           WHERE id = ?`
        )
          .bind(
            item.description,
            item.pricePence,
            station,
            now,
            existingItem.id
          )
          .run();
      } else {
        await env.DB.prepare(
          `INSERT INTO menu_items (
             id, organization_id, location_id, category_id, name, description,
             price_pence, station, sort_order, is_active, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
        )
          .bind(
            crypto.randomUUID(),
            orgId,
            locationId,
            categoryId,
            item.name,
            item.description,
            item.pricePence,
            station,
            itemOrder,
            now,
            now
          )
          .run();
      }
      itemOrder += 10;
    }
    catOrder += 10;
  }

  return getKitchenMenu(env, locationId);
}

export async function createMenuCategory(
  env: Env,
  locationId: string,
  input: { name: string; station?: string }
): Promise<KitchenMenuCategory> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const station = input.station?.trim() || "restaurant";
  await env.DB.prepare(
    `INSERT INTO menu_categories (
       id, organization_id, location_id, name, station, sort_order,
       is_active, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, 500, 1, ?, ?)`
  )
    .bind(id, env.ORGANIZATION_ID, locationId, input.name.trim(), station, now, now)
    .run();

  const menu = await getKitchenMenu(env, locationId);
  const created = menu.find((c) => c.id === id);
  if (!created) {
    return { id, name: input.name.trim(), station, sortOrder: 500, items: [] };
  }
  return created;
}

export async function createMenuItem(
  env: Env,
  locationId: string,
  input: {
    categoryId: string;
    name: string;
    pricePence?: number;
    station?: string;
    description?: string | null;
  }
): Promise<KitchenMenuItem | null> {
  const cat = await env.DB.prepare(
    `SELECT id, station FROM menu_categories
     WHERE id = ? AND organization_id = ? AND location_id = ? AND is_active = 1`
  )
    .bind(input.categoryId, env.ORGANIZATION_ID, locationId)
    .first<{ id: string; station: string }>();
  if (!cat) return null;

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const station = input.station?.trim() || cat.station || "restaurant";
  await env.DB.prepare(
    `INSERT INTO menu_items (
       id, organization_id, location_id, category_id, name, description,
       price_pence, station, sort_order, is_active, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 500, 1, ?, ?)`
  )
    .bind(
      id,
      env.ORGANIZATION_ID,
      locationId,
      input.categoryId,
      input.name.trim(),
      input.description ?? null,
      Math.max(0, Math.round(input.pricePence ?? 0)),
      station,
      now,
      now
    )
    .run();

  return {
    id,
    categoryId: input.categoryId,
    name: input.name.trim(),
    description: input.description ?? null,
    pricePence: Math.max(0, Math.round(input.pricePence ?? 0)),
    station,
    sortOrder: 500,
  };
}

export async function deactivateMenuItem(
  env: Env,
  locationId: string,
  itemId: string
): Promise<boolean> {
  const result = await env.DB.prepare(
    `UPDATE menu_items SET is_active = 0, updated_at = datetime('now')
     WHERE id = ? AND organization_id = ? AND location_id = ?`
  )
    .bind(itemId, env.ORGANIZATION_ID, locationId)
    .run();
  return (result.meta?.changes ?? 0) > 0;
}

export type ReorderMenuInput = {
  categories?: { id: string; sortOrder: number; station?: string }[];
  items?: { id: string; sortOrder: number; categoryId?: string }[];
};

export async function reorderKitchenMenu(
  env: Env,
  locationId: string,
  input: ReorderMenuInput
): Promise<KitchenMenuCategory[]> {
  const orgId = env.ORGANIZATION_ID;
  const now = new Date().toISOString();
  const stmts: D1PreparedStatement[] = [];

  for (const cat of input.categories ?? []) {
    if (cat.station) {
      stmts.push(
        env.DB.prepare(
          `UPDATE menu_categories
           SET sort_order = ?, station = ?, updated_at = ?
           WHERE id = ? AND organization_id = ? AND location_id = ? AND is_active = 1`
        ).bind(cat.sortOrder, cat.station, now, cat.id, orgId, locationId)
      );
    } else {
      stmts.push(
        env.DB.prepare(
          `UPDATE menu_categories
           SET sort_order = ?, updated_at = ?
           WHERE id = ? AND organization_id = ? AND location_id = ? AND is_active = 1`
        ).bind(cat.sortOrder, now, cat.id, orgId, locationId)
      );
    }
  }

  for (const item of input.items ?? []) {
    if (item.categoryId) {
      stmts.push(
        env.DB.prepare(
          `UPDATE menu_items
           SET sort_order = ?, category_id = ?, updated_at = ?
           WHERE id = ? AND organization_id = ? AND location_id = ? AND is_active = 1`
        ).bind(
          item.sortOrder,
          item.categoryId,
          now,
          item.id,
          orgId,
          locationId
        )
      );
    } else {
      stmts.push(
        env.DB.prepare(
          `UPDATE menu_items
           SET sort_order = ?, updated_at = ?
           WHERE id = ? AND organization_id = ? AND location_id = ? AND is_active = 1`
        ).bind(item.sortOrder, now, item.id, orgId, locationId)
      );
    }
  }

  if (stmts.length > 0) {
    await env.DB.batch(stmts);
  }
  return getKitchenMenu(env, locationId);
}
