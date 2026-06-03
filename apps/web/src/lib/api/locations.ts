import { API_URL } from "./client";

export interface ScheduleSlotInput {
  dayOfWeek: string;
  startTime: string;
  displayLabel: string;
  sortOrder?: number;
}

export interface AdminLocation {
  id: string;
  name: string;
  abbrev: string;
  badge_count: number | null;
  programmes: Record<
    string,
    Array<{
      id: string;
      dayOfWeek: string;
      startTime: string;
      displayLabel: string;
      sortOrder: number;
    }>
  >;
}

export async function fetchAdminLocations(): Promise<AdminLocation[]> {
  const res = await fetch(`${API_URL}/admin/locations`);
  const json = (await res.json()) as {
    locations?: AdminLocation[];
    error?: string;
  };
  if (!res.ok) throw new Error(json.error ?? "Failed to load locations");
  return json.locations ?? [];
}

export async function createLocation(data: {
  id: string;
  name: string;
  abbrev: string;
}) {
  const res = await fetch(`${API_URL}/admin/locations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  const json = await res.json();
  if (!res.ok) throw new Error((json as { error?: string }).error ?? "Failed");
  return json;
}

export async function updateLocation(
  id: string,
  data: { name?: string; abbrev?: string }
) {
  const res = await fetch(`${API_URL}/admin/locations/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  const json = await res.json();
  if (!res.ok) throw new Error((json as { error?: string }).error ?? "Failed");
  return json;
}

export async function saveProgrammeSchedule(
  locationId: string,
  programme: string,
  slots: ScheduleSlotInput[]
) {
  const res = await fetch(`${API_URL}/admin/locations/${locationId}/schedules`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ programme, slots }),
  });
  const json = (await res.json()) as { message?: string; error?: string };
  if (!res.ok) throw new Error(json.error ?? "Failed to save schedule");
  return json;
}
