/** Where an item is prepared / fired — first-class in menu editing. */

export const MENU_STATIONS = [
  {
    id: "restaurant",
    label: "Restaurant",
    hint: "Hot food / mains",
    aliases: ["restaurant", "kitchen", "food", "dining"],
  },
  {
    id: "cafe",
    label: "Cafe",
    hint: "Coffee & soft drinks",
    aliases: ["cafe", "coffee", "café"],
  },
  {
    id: "bar",
    label: "Bar",
    hint: "Alcohol & cocktails",
    aliases: ["bar", "drinks", "cocktail"],
  },
] as const;

export type MenuStationId = (typeof MENU_STATIONS)[number]["id"];

export function normalizeStation(raw: string | null | undefined): MenuStationId {
  const s = (raw ?? "").trim().toLowerCase();
  for (const st of MENU_STATIONS) {
    if (st.id === s || (st.aliases as readonly string[]).includes(s)) {
      return st.id;
    }
  }
  return "restaurant";
}

export function stationLabel(raw: string | null | undefined): string {
  const id = normalizeStation(raw);
  return MENU_STATIONS.find((s) => s.id === id)?.label ?? id;
}

export function stationMatches(
  itemOrCatStation: string | null | undefined,
  filterId: string
): boolean {
  return normalizeStation(itemOrCatStation) === normalizeStation(filterId);
}
