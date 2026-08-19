import { monthGrid, monthLabel, shiftMonth } from "../uiChrome";
import { Icon } from "./Icons";

export function ReminderCalendar({
  year,
  month,
  weekStartsOn,
  selectedDay,
  markedDays,
  onChangeMonth,
  onSelectDay,
}: {
  year: number;
  month: number;
  weekStartsOn: "sunday" | "monday";
  selectedDay: string | null;
  markedDays: string[];
  onChangeMonth: (year: number, month: number) => void;
  onSelectDay: (dayKey: string | null) => void;
}) {
  const days = monthGrid(year, month, weekStartsOn);
  const labels =
    weekStartsOn === "monday"
      ? ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"]
      : ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
  const marked = new Set(markedDays);

  return (
    <div className="reminder-calendar" aria-label="Reminder calendar">
      <div className="reminder-calendar-head">
        <button
          type="button"
          className="icon-btn"
          title="Previous month"
          onClick={() => {
            const next = shiftMonth(year, month, -1);
            onChangeMonth(next.year, next.month);
          }}
        >
          <Icon.Back size={14} />
        </button>
        <strong>{monthLabel(year, month)}</strong>
        <button
          type="button"
          className="icon-btn"
          title="Next month"
          onClick={() => {
            const next = shiftMonth(year, month, 1);
            onChangeMonth(next.year, next.month);
          }}
        >
          <Icon.Forward size={14} />
        </button>
      </div>
      <div className="reminder-calendar-weekdays">
        {labels.map((label) => (
          <span key={label}>{label}</span>
        ))}
      </div>
      <div className="reminder-calendar-grid">
        {days.map((day) => (
          <button
            key={day.key}
            type="button"
            className={
              "reminder-calendar-day" +
              (day.inMonth ? "" : " is-outside") +
              (day.isToday ? " is-today" : "") +
              (selectedDay === day.key ? " is-selected" : "") +
              (marked.has(day.key) ? " has-reminder" : "")
            }
            onClick={() => onSelectDay(selectedDay === day.key ? null : day.key)}
          >
            {day.day}
          </button>
        ))}
      </div>
    </div>
  );
}
