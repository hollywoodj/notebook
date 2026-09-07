export type NavLocation = {
  filter: {
    type: string;
    id?: string;
    name?: string;
    query?: string;
  };
  noteId: string | null;
};

export function sameNavLocation(a: NavLocation, b: NavLocation): boolean {
  if ((a.noteId || null) !== (b.noteId || null)) return false;
  if (a.filter.type !== b.filter.type) return false;
  if ((a.filter.id || "") !== (b.filter.id || "")) return false;
  if ((a.filter.query || "") !== (b.filter.query || "")) return false;
  return true;
}

export function pushNavHistory(
  past: NavLocation[],
  current: NavLocation,
  next: NavLocation,
  limit = 50
): { past: NavLocation[]; future: NavLocation[] } | null {
  if (sameNavLocation(current, next)) return null;
  return {
    past: [...past, current].slice(-limit),
    future: [],
  };
}

export function stepNavBack(
  past: NavLocation[],
  current: NavLocation,
  future: NavLocation[]
): { past: NavLocation[]; current: NavLocation; future: NavLocation[] } | null {
  if (!past.length) return null;
  return {
    past: past.slice(0, -1),
    current: past[past.length - 1],
    future: [current, ...future],
  };
}

export function stepNavForward(
  past: NavLocation[],
  current: NavLocation,
  future: NavLocation[]
): { past: NavLocation[]; current: NavLocation; future: NavLocation[] } | null {
  if (!future.length) return null;
  const [next, ...rest] = future;
  return {
    past: [...past, current],
    current: next,
    future: rest,
  };
}

export const LAST_SESSION_KEY = "notebook.lastSession";

export type LastSession = NavLocation;

export function parseLastSession(raw: string | null): LastSession | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<LastSession>;
    if (!parsed || typeof parsed !== "object" || !parsed.filter?.type) return null;
    return {
      filter: {
        type: String(parsed.filter.type),
        id: parsed.filter.id,
        name: parsed.filter.name,
        query: parsed.filter.query,
      },
      noteId: parsed.noteId || null,
    };
  } catch {
    return null;
  }
}

export const RECENT_NOTES_KEY = "notebook.recentNotes";

export type RecentNote = { id: string; title: string };

export function parseRecentNotes(raw: string | null): RecentNote[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => item && typeof item.id === "string")
      .map((item) => ({
        id: String(item.id),
        title: String(item.title || "Untitled"),
      }))
      .slice(0, 12);
  } catch {
    return [];
  }
}

export function rememberRecentNote(
  list: RecentNote[],
  note: RecentNote,
  limit = 12
): RecentNote[] {
  if (!note.id) return list;
  return [
    { id: note.id, title: note.title.trim() || "Untitled" },
    ...list.filter((item) => item.id !== note.id),
  ].slice(0, limit);
}

export function viewFilterKey(
  filter: { type: string; id?: string; query?: string },
  searchScopeId?: string | null
): string {
  const scope = searchScopeId ? `@${searchScopeId}` : "";
  if (filter.type === "notebook" || filter.type === "tag") {
    return `${filter.type}:${filter.id || ""}${scope}`;
  }
  if (filter.type === "search") {
    return `search:${filter.query || ""}${scope}`;
  }
  return `${filter.type}${scope}`;
}

export function viewTitleForFilter(
  filter: { type: string; name?: string; query?: string }
): string {
  if (filter.type === "all") return "Notes";
  if (filter.type === "notebook") return filter.name || "Notebook";
  if (filter.type === "tag") return `#${filter.name || "tag"}`;
  if (filter.type === "shortcuts") return "Shortcuts";
  if (filter.type === "reminders") return "Reminders";
  if (filter.type === "templates") return "Templates";
  if (filter.type === "trash") return "Trash";
  if (filter.type === "archived") return "Archived";
  if (filter.type === "files") return "Files";
  if (filter.type === "search") return `Search: ${filter.query || ""}`;
  return "Notes";
}
