"use client";

import {
  WEEK_DAYS,
  newEventId,
  timeToLabel,
  type DayEvent,
  type DayId,
  type WeekSchedule,
} from "@/lib/schedule-calendar";

type Props = {
  schedule: WeekSchedule;
  onChange: (next: WeekSchedule) => void;
  serviceLabel?: string;
};

export function ScheduleWeekCalendar({
  schedule,
  onChange,
  serviceLabel = "session",
}: Props) {
  const updateDay = (day: DayId, events: DayEvent[]) => {
    onChange({ ...schedule, [day]: events });
  };

  const addEvent = (day: DayId) => {
    const events = [...schedule[day]];
    events.push({
      id: newEventId(),
      startTime: "17:00",
      displayLabel: "5pm",
    });
    updateDay(day, events);
  };

  const patchEvent = (day: DayId, id: string, patch: Partial<DayEvent>) => {
    updateDay(
      day,
      schedule[day].map((e) => (e.id === id ? { ...e, ...patch } : e))
    );
  };

  const removeEvent = (day: DayId, id: string) => {
    updateDay(
      day,
      schedule[day].filter((e) => e.id !== id)
    );
  };

  return (
    <div className="week-calendar">
      <div className="week-calendar-grid">
        {WEEK_DAYS.map((day) => (
          <div key={day.id} className="week-calendar-day">
            <div className="week-calendar-day-head">{day.label}</div>
            <div className="week-calendar-events">
              {schedule[day.id].length === 0 ? (
                <p className="week-calendar-empty">No {serviceLabel}s</p>
              ) : (
                schedule[day.id].map((ev) => (
                  <div key={ev.id} className="week-calendar-event">
                    <input
                      type="time"
                      value={ev.startTime}
                      onChange={(e) => {
                        const startTime = e.target.value;
                        patchEvent(day.id, ev.id, {
                          startTime,
                          displayLabel: timeToLabel(startTime),
                        });
                      }}
                      className="workspace-input week-calendar-time"
                      aria-label={`${day.label} start time`}
                    />
                    <input
                      value={ev.displayLabel}
                      onChange={(e) =>
                        patchEvent(day.id, ev.id, {
                          displayLabel: e.target.value,
                        })
                      }
                      className="workspace-input week-calendar-label"
                      placeholder="SMS label"
                      aria-label={`${day.label} label`}
                    />
                    <button
                      type="button"
                      className="week-calendar-remove"
                      onClick={() => removeEvent(day.id, ev.id)}
                      aria-label="Remove"
                    >
                      ×
                    </button>
                  </div>
                ))
              )}
            </div>
            <button
              type="button"
              className="week-calendar-add"
              onClick={() => addEvent(day.id)}
            >
              + Add
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
