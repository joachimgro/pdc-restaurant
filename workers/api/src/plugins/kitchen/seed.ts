import type { Env } from "../../env";

/**
 * Demo menu for the Test Kitchen location.
 * Call from /admin/seed when ENABLE_DEMO_TOOLS and ENABLE_KITCHEN are on.
 */
export async function seedKitchenMenu(
  env: Env,
  locationId: string
): Promise<{ seeded: boolean }> {
  const existing = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM menu_categories
     WHERE organization_id = ? AND location_id = ?`
  )
    .bind(env.ORGANIZATION_ID, locationId)
    .first<{ n: number }>();

  if ((existing?.n ?? 0) > 0) {
    return { seeded: false };
  }

  const orgId = env.ORGANIZATION_ID;
  const now = new Date().toISOString();

  const categories = [
    { id: "menu-cat-coffee", name: "Coffee & Cake", station: "cafe", sort: 10 },
    { id: "menu-cat-bar", name: "Cocktails", station: "bar", sort: 15 },
    { id: "menu-cat-mains", name: "Mains", station: "restaurant", sort: 20 },
  ];

  const items = [
    {
      id: "menu-espresso",
      cat: "menu-cat-coffee",
      name: "Espresso",
      station: "cafe",
      price: 250,
      sort: 10,
    },
    {
      id: "menu-flat-white",
      cat: "menu-cat-coffee",
      name: "Flat White",
      station: "cafe",
      price: 350,
      sort: 20,
    },
    {
      id: "menu-negroni",
      cat: "menu-cat-bar",
      name: "Negroni",
      station: "bar",
      price: 950,
      sort: 10,
    },
    {
      id: "menu-burger",
      cat: "menu-cat-mains",
      name: "House Burger",
      station: "restaurant",
      price: 1650,
      sort: 10,
    },
    {
      id: "menu-salmon",
      cat: "menu-cat-mains",
      name: "Pan-seared Salmon",
      station: "restaurant",
      price: 2200,
      sort: 20,
    },
    {
      id: "menu-pasta",
      cat: "menu-cat-mains",
      name: "Tagliatelle",
      station: "restaurant",
      price: 1450,
      sort: 30,
    },
  ];

  const stmts: D1PreparedStatement[] = [];

  for (const cat of categories) {
    stmts.push(
      env.DB.prepare(
        `INSERT INTO menu_categories (
           id, organization_id, location_id, name, station, sort_order, is_active, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`
      ).bind(cat.id, orgId, locationId, cat.name, cat.station, cat.sort, now, now)
    );
  }

  for (const item of items) {
    stmts.push(
      env.DB.prepare(
        `INSERT INTO menu_items (
           id, organization_id, location_id, category_id, name, station,
           price_pence, sort_order, is_active, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
      ).bind(
        item.id,
        orgId,
        locationId,
        item.cat,
        item.name,
        item.station,
        item.price,
        item.sort,
        now,
        now
      )
    );
  }

  await env.DB.batch(stmts);
  return { seeded: true };
}
