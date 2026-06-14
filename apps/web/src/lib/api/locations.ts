import { apiFetch } from "./client";

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
  const json = await apiFetch<{ locations?: AdminLocation[] }>(
    "/admin/locations"
  );
  return json.locations ?? [];
}

export async function createLocation(data: {
  id: string;
  name: string;
  abbrev: string;
}) {
  return apiFetch("/admin/locations", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function updateLocation(
  id: string,
  data: { name?: string; abbrev?: string }
) {
  return apiFetch(`/admin/locations/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

export async function saveProgrammeSchedule(
  locationId: string,
  programme: string,
  slots: ScheduleSlotInput[]
) {
  return apiFetch<{ message?: string }>(
    `/admin/locations/${encodeURIComponent(locationId)}/schedules`,
    {
      method: "PUT",
      body: JSON.stringify({ programme, slots }),
    }
  );
}
