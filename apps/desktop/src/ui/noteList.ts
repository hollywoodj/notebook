import type { DateRangeFacet, NoteListFacet } from "./search.ts";
export const NOTE_DRAG_TYPE = "application/x-notebook-notes";

export function encodeNoteDrag(ids: string[]): string {
  return JSON.stringify(ids);
}

export function decodeNoteDrag(data: string): string[] {
  try {
    const parsed = JSON.parse(data);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is string => typeof id === "string" && id.length > 0);
  } catch {
    return [];
  }
}

export function adjacentNoteId<T extends { id: string }>(
  notes: T[],
  currentId: string | null,
  direction: -1 | 1
): string | null {
  if (notes.length === 0) return null;
  if (!currentId) return notes[0].id;
  const idx = notes.findIndex((note) => note.id === currentId);
  if (idx < 0) return notes[0].id;
  const next = idx + direction;
  if (next < 0 || next >= notes.length) return currentId;
  return notes[next].id;
}

export type ListView = "snippets" | "titles" | "cards";

export function resolveListView(prefs: {
  list_view?: ListView | null;
  show_snippets?: boolean;
}): ListView {
  if (prefs.list_view === "snippets" || prefs.list_view === "titles" || prefs.list_view === "cards") {
    return prefs.list_view;
  }
  return prefs.show_snippets === false ? "titles" : "snippets";
}

export type NoteListGroup<T> = { key: string; label: string; notes: T[] };

function startOfLocalDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

export function groupNotesForList<
  T extends { is_pinned: boolean; created_at: string; updated_at: string },
>(
  notes: T[],
  sortBy: "updated" | "created" | "title" | "reminder",
  now = new Date()
): NoteListGroup<T>[] {
  if (sortBy === "title") {
    const pinned = notes.filter((note) => note.is_pinned);
    const rest = notes.filter((note) => !note.is_pinned);
    const groups: NoteListGroup<T>[] = [];
    if (pinned.length) groups.push({ key: "pinned", label: "Pinned", notes: pinned });
    if (rest.length) groups.push({ key: "all", label: "", notes: rest });
    return groups.length ? groups : [{ key: "all", label: "", notes }];
  }

  const today = startOfLocalDay(now);
  const yesterday = today - 86_400_000;
  const week = today - 7 * 86_400_000;
  const buckets: Record<string, T[]> = {
    pinned: [],
    today: [],
    yesterday: [],
    week: [],
    earlier: [],
  };
  for (const note of notes) {
    if (note.is_pinned) {
      buckets.pinned.push(note);
      continue;
    }
    const stamp = startOfLocalDay(
      new Date(sortBy === "created" ? note.created_at : note.updated_at)
    );
    if (stamp >= today) buckets.today.push(note);
    else if (stamp >= yesterday) buckets.yesterday.push(note);
    else if (stamp >= week) buckets.week.push(note);
    else buckets.earlier.push(note);
  }
  return (
    [
      ["pinned", "Pinned"],
      ["today", "Today"],
      ["yesterday", "Yesterday"],
      ["week", "Previous 7 Days"],
      ["earlier", "Earlier"],
    ] as const
  )
    .filter(([key]) => buckets[key].length > 0)
    .map(([key, label]) => ({ key, label, notes: buckets[key] }));
}

export function groupNotesByNotebook<T extends { notebook_name: string }>(
  notes: T[]
): NoteListGroup<T>[] {
  const buckets = new Map<string, T[]>();
  for (const note of notes) {
    const name = note.notebook_name.trim() || "Notebook";
    const current = buckets.get(name) ?? [];
    current.push(note);
    buckets.set(name, current);
  }
  return [...buckets.entries()].map(([label, grouped]) => ({
    key: `notebook:${label}`,
    label,
    notes: grouped,
  }));
}

export type EmptyView =
  | "all"
  | "notebook"
  | "tag"
  | "shortcuts"
  | "reminders"
  | "templates"
  | "trash"
  | "search"
  | "archived" | "files";

export function emptyStateCopy(
  view: EmptyView,
  name = ""
): { title: string; body: string } {
  switch (view) {
    case "notebook":
      return {
        title: "This notebook is empty",
        body: name
          ? `Create a note in “${name}” to get started.`
          : "Create a note in this notebook to get started.",
      };
    case "tag":
      return {
        title: "No notes with this tag",
        body: name
          ? `Tag notes with “${name}” to see them here.`
          : "Tag notes to see them here.",
      };
    case "shortcuts":
      return {
        title: "No shortcuts yet",
        body: "Star a note to pin it here for quick access.",
      };
    case "reminders":
      return {
        title: "No reminders",
        body: "Set a reminder on a note and it will appear in this list.",
      };
    case "templates":
      return {
        title: "No templates yet",
        body: "Open the gallery to add a template, or save a note as a template.",
      };
    case "files":
      return {
        title: "No files yet",
        body: "Files you attach to notes are collected here, across every notebook.",
      };
    case "trash":
      return {
        title: "Trash is empty",
        body: "Notes you delete will stay here until you empty Trash.",
      };
    case "search":
      return {
        title: "No matching notes",
        body: name
          ? `No notes matched “${name}”. Try another search.`
          : "Try another search.",
      };
    default:
      return {
        title: "Create your first note",
        body: "Click New note to capture an idea, meeting, or anything else.",
      };
  }
}

export function attachmentCountLabel(count: number): string | null {
  if (!Number.isFinite(count) || count <= 0) return null;
  return count === 1 ? "1 attachment" : `${Math.round(count)} attachments`;
}

export function sortNotes<
  T extends {
    is_pinned: boolean;
    title: string;
    created_at: string;
    updated_at: string;
    reminder_at?: string | null;
  },
>(
  notes: T[],
  sortBy: "updated" | "created" | "title" | "reminder",
  descending = false
): T[] {
  const dir = descending ? -1 : 1;
  return [...notes].sort((a, b) => {
    if (a.is_pinned !== b.is_pinned) return a.is_pinned ? -1 : 1;
    let cmp = 0;
    if (sortBy === "title") cmp = a.title.localeCompare(b.title);
    else if (sortBy === "created") {
      cmp = new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    } else if (sortBy === "reminder") {
      cmp = new Date(a.reminder_at || 0).getTime() - new Date(b.reminder_at || 0).getTime();
    } else {
      cmp = new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
    }
    return cmp * dir;
  });
}

export function formatRelativeTime(iso: string, now = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const delta = now.getTime() - date.getTime();
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (delta < minute) return "Just now";
  if (delta < hour) {
    const mins = Math.floor(delta / minute);
    return mins === 1 ? "1 minute ago" : `${mins} minutes ago`;
  }
  if (delta < day) {
    const hours = Math.floor(delta / hour);
    return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
  }
  if (delta < 2 * day && startOfLocalDay(date) === startOfLocalDay(now) - day) {
    return "Yesterday";
  }
  if (delta < 7 * day) {
    const days = Math.floor(delta / day);
    return days === 1 ? "1 day ago" : `${days} days ago`;
  }
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function listCountLabel(visible: number, total: number, loaded = true): string {
  if (!loaded) return "";
  const count = visible === 1 ? "1 note" : `${visible} notes`;
  if (visible === total || total <= 0) return count;
  return `${count} of ${total}`;
}

export function navCountLabel(count: number | null | undefined): string {
  return typeof count === "number" && Number.isFinite(count) ? String(Math.round(count)) : "";
}

export function displayedListCount(args: {
  loaded: boolean;
  visible: number;
  total: number;
  known?: number | null;
  lastLabel?: string;
}): string {
  const known =
    typeof args.known === "number" && Number.isFinite(args.known) ? args.known : null;
  if (args.loaded) {
    if (args.total === 0 && known != null && known > 0) {
      return listCountLabel(known, known, true);
    }
    return listCountLabel(args.visible, args.total, true);
  }
  if (known != null) return listCountLabel(known, known, true);
  const last = args.lastLabel || "";
  return last === "0 notes" ? "" : last;
}

export function knownViewNoteCount(
  filter: { type: string; id?: string },
  notebooks: { id: string; note_count?: number }[],
  tags: { id: string; note_count?: number }[],
  counts: {
    notes: number;
    reminders: number;
    templates: number;
    trash: number;
    shortcuts?: number;
  } | null,
  shortcutCount?: number
): number | undefined {
  switch (filter.type) {
    case "notebook": {
      const notebook = notebooks.find((item) => item.id === filter.id);
      return typeof notebook?.note_count === "number" ? notebook.note_count : undefined;
    }
    case "tag": {
      const tag = tags.find((item) => item.id === filter.id);
      return typeof tag?.note_count === "number" ? tag.note_count : undefined;
    }
    case "all":
      return typeof counts?.notes === "number" ? counts.notes : undefined;
    case "reminders":
      return typeof counts?.reminders === "number" ? counts.reminders : undefined;
    case "templates":
      return typeof counts?.templates === "number" ? counts.templates : undefined;
    case "trash":
      return typeof counts?.trash === "number" ? counts.trash : undefined;
    case "shortcuts":
      if (typeof shortcutCount === "number") return shortcutCount;
      return typeof counts?.shortcuts === "number" ? counts.shortcuts : undefined;
    default:
      return undefined;
  }
}

export function stickyNavCount(
  current: number,
  previous: number | null | undefined
): number | undefined {
  if (current > 0) return current;
  if (typeof previous === "number") return previous;
  return undefined;
}

export function hasActiveListFilters(
  facets: NoteListFacet[],
  range: DateRangeFacet
): boolean {
  return facets.length > 0 || range !== "any";
}

export function noteIdByOffset<T extends { id: string }>(
  notes: T[],
  currentId: string | null,
  offset: number
): string | null {
  if (notes.length === 0) return null;
  if (!currentId) return notes[offset >= 0 ? 0 : notes.length - 1]?.id ?? null;
  const idx = notes.findIndex((note) => note.id === currentId);
  if (idx < 0) return notes[0].id;
  const next = Math.min(notes.length - 1, Math.max(0, idx + offset));
  return notes[next].id;
}

export function trashToastCopy(count: number, title: string): string {
  if (count > 1) return `${count} notes moved to Trash`;
  const cleaned = title.trim() || "Untitled";
  return `“${cleaned}” moved to Trash`;
}
