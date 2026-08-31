import type { NoteListGroup } from "./noteList.ts";

export function toDatetimeLocalValue(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export function fromDatetimeLocalValue(value: string): string | null {
  if (!value.trim()) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

export function isReminderOverdue(iso: string | null, now = new Date()): boolean {
  if (!iso) return false;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return false;
  return date.getTime() < now.getTime();
}

export function formatReminderLabel(
  iso: string,
  format: "short" | "medium" | "long" = "medium"
): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const datePart =
    format === "short"
      ? date.toLocaleDateString(undefined, { month: "numeric", day: "numeric" })
      : format === "long"
        ? date.toLocaleDateString(undefined, {
            weekday: "short",
            month: "long",
            day: "numeric",
          })
        : date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const timePart = date.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  return `${datePart}, ${timePart}`;
}

export type ReminderPreset = "tonight" | "tomorrow" | "nextWeek";

export function reminderFromPreset(kind: ReminderPreset, now = new Date()): string {
  const date = new Date(now.getTime());
  if (kind === "tonight") {
    date.setHours(18, 0, 0, 0);
    if (date.getTime() <= now.getTime()) date.setDate(date.getDate() + 1);
  } else if (kind === "tomorrow") {
    date.setDate(date.getDate() + 1);
    date.setHours(9, 0, 0, 0);
  } else {
    date.setDate(date.getDate() + 7);
    date.setHours(9, 0, 0, 0);
  }
  return date.toISOString();
}

export type SnoozePreset = "laterToday" | "tomorrowMorning";

export function reminderFromSnooze(kind: SnoozePreset, now = new Date()): string {
  if (kind === "tomorrowMorning") return reminderFromPreset("tomorrow", now);
  const later = new Date(now.getTime() + 3 * 60 * 60 * 1000);
  return later.toISOString();
}

function startOfLocalDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

export function groupRemindersForList<
  T extends { reminder_at: string | null; id: string },
>(notes: T[], completedIds: string[], now = new Date()): NoteListGroup<T>[] {
  const today = startOfLocalDay(now);
  const tomorrow = today + 86_400_000;
  const completed = new Set(completedIds);
  const buckets: Record<string, T[]> = {
    overdue: [],
    today: [],
    tomorrow: [],
    later: [],
    completed: [],
  };
  for (const note of notes) {
    if (!note.reminder_at) continue;
    if (completed.has(note.id)) {
      buckets.completed.push(note);
      continue;
    }
    const stamp = new Date(note.reminder_at).getTime();
    if (Number.isNaN(stamp) || stamp < now.getTime()) buckets.overdue.push(note);
    else if (stamp < tomorrow) buckets.today.push(note);
    else if (stamp < tomorrow + 86_400_000) buckets.tomorrow.push(note);
    else buckets.later.push(note);
  }
  return (
    [
      ["overdue", "Overdue"],
      ["today", "Today"],
      ["tomorrow", "Tomorrow"],
      ["later", "Later"],
      ["completed", "Completed"],
    ] as const
  )
    .filter(([key]) => buckets[key].length > 0)
    .map(([key, label]) => ({ key, label, notes: buckets[key] }));
}

export const COMPLETED_REMINDERS_KEY = "notebook.completedReminders";

export function parseCompletedReminders(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is string => typeof id === "string" && id.length > 0);
  } catch {
    return [];
  }
}

export function toggleCompletedReminder(ids: string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id];
}

export function isReminderDone(ids: string[], id: string): boolean {
  return ids.includes(id);
}

export function groupNotesByReminder<T extends { reminder_at?: string | null }>(
  notes: T[],
  now = new Date()
): NoteListGroup<T>[] {
  const today = startOfLocalDay(now);
  const tomorrow = today + 86_400_000;
  const buckets: Record<string, T[]> = {
    overdue: [],
    today: [],
    tomorrow: [],
    later: [],
    none: [],
  };
  for (const note of notes) {
    if (!note.reminder_at) {
      buckets.none.push(note);
      continue;
    }
    const stamp = startOfLocalDay(new Date(note.reminder_at));
    if (Number.isNaN(stamp)) {
      buckets.none.push(note);
    } else if (stamp < today) buckets.overdue.push(note);
    else if (stamp === today) buckets.today.push(note);
    else if (stamp === tomorrow) buckets.tomorrow.push(note);
    else buckets.later.push(note);
  }
  return (
    [
      ["overdue", "Overdue"],
      ["today", "Today"],
      ["tomorrow", "Tomorrow"],
      ["later", "Later"],
      ["none", "No reminder"],
    ] as const
  )
    .filter(([key]) => buckets[key].length > 0)
    .map(([key, label]) => ({ key, label, notes: buckets[key] }));
}

export function reminderFallsOnDay(iso: string | null, dayKey: string): boolean {
  if (!iso) return false;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return false;
  return isoDayKey(date) === dayKey;
}

export function isoDayKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export type CalendarDay = {
  key: string;
  day: number;
  inMonth: boolean;
  isToday: boolean;
};

export function monthGrid(
  year: number,
  month: number,
  weekStartsOn: "sunday" | "monday",
  now = new Date()
): CalendarDay[] {
  const first = new Date(year, month, 1);
  const startWeekday = first.getDay();
  const mondayOffset = weekStartsOn === "monday" ? (startWeekday + 6) % 7 : startWeekday;
  const gridStart = new Date(year, month, 1 - mondayOffset);
  const todayKey = isoDayKey(now);
  const days: CalendarDay[] = [];
  for (let i = 0; i < 42; i += 1) {
    const date = new Date(gridStart);
    date.setDate(gridStart.getDate() + i);
    const key = isoDayKey(date);
    days.push({
      key,
      day: date.getDate(),
      inMonth: date.getMonth() === month,
      isToday: key === todayKey,
    });
  }
  return days;
}

export function monthLabel(year: number, month: number): string {
  return new Date(year, month, 1).toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });
}

export function shiftMonth(
  year: number,
  month: number,
  delta: number
): { year: number; month: number } {
  const date = new Date(year, month + delta, 1);
  return { year: date.getFullYear(), month: date.getMonth() };
}
