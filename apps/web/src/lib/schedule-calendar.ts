export const WEEK_DAYS = [
  { id: "mon", label: "Mon", short: "M" },
  { id: "tue", label: "Tue", short: "T" },
  { id: "wed", label: "Wed", short: "W" },
  { id: "thu", label: "Thu", short: "T" },
  { id: "fri", label: "Fri", short: "F" },
  { id: "sat", label: "Sat", short: "S" },
  { id: "sun", label: "Sun", short: "S" },
] as const;

export type DayId = (typeof WEEK_DAYS)[number]["id"];

export type DayEvent = {
  id: string;
  startTime: string;
  displayLabel: string;
};

export type WeekSchedule = Record<DayId, DayEvent[]>;

export function emptyWeekSchedule(): WeekSchedule {
  return {
    mon: [],
    tue: [],
    wed: [],
    thu: [],
    fri: [],
    sat: [],
    sun: [],
  };
}

export function timeToLabel(time: string): string {
  const [h, m] = time.split(":").map(Number);
  if (Number.isNaN(h)) return time;
  const suffix = h >= 12 ? "pm" : "am";
  const hour12 = h % 12 || 12;
  return m ? `${hour12}:${String(m).padStart(2, "0")}${suffix}` : `${hour12}${suffix}`;
}

export function scheduleRowsToWeek(
  rows: Array<{
    id: string;
    dayOfWeek: string;
    startTime: string;
    displayLabel: string;
  }>
): WeekSchedule {
  const week = emptyWeekSchedule();
  for (const row of rows) {
    const day = row.dayOfWeek as DayId;
    if (!week[day]) continue;
    week[day].push({
      id: row.id || `${day}-${row.startTime}-${row.displayLabel}`,
      startTime: row.startTime,
      displayLabel: row.displayLabel,
    });
  }
  for (const day of WEEK_DAYS) {
    week[day.id].sort((a, b) => a.startTime.localeCompare(b.startTime));
  }
  return week;
}

export function weekToScheduleSlots(week: WeekSchedule): Array<{
  dayOfWeek: string;
  startTime: string;
  displayLabel: string;
  sortOrder: number;
}> {
  const out: Array<{
    dayOfWeek: string;
    startTime: string;
    displayLabel: string;
    sortOrder: number;
  }> = [];
  let order = 0;
  for (const day of WEEK_DAYS) {
    for (const ev of week[day.id]) {
      out.push({
        dayOfWeek: day.id,
        startTime: ev.startTime,
        displayLabel: ev.displayLabel || timeToLabel(ev.startTime),
        sortOrder: order++,
      });
    }
  }
  return out;
}

export function newEventId(): string {
  return `ev-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}
