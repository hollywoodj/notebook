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
  sortBy: "updated" | "created" | "title",
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
  | "files"
  | "trash"
  | "search";

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
