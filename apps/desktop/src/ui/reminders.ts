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
