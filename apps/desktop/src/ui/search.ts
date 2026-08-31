export type FindMatchOptions = {
  caseSensitive?: boolean;
  wholeWord?: boolean;
};

function isWordChar(ch: string | undefined): boolean {
  return Boolean(ch && /[A-Za-z0-9_]/.test(ch));
}

export function findMatchOffsets(
  text: string,
  query: string,
  options: FindMatchOptions = {}
): number[] {
  const raw = query.trim();
  if (!raw) return [];
  const needle = options.caseSensitive ? raw : raw.toLowerCase();
  const hay = options.caseSensitive ? text : text.toLowerCase();
  const offsets: number[] = [];
  let from = 0;
  while (from <= hay.length - needle.length) {
    const idx = hay.indexOf(needle, from);
    if (idx < 0) break;
    if (
      options.wholeWord &&
      (isWordChar(hay[idx - 1]) || isWordChar(hay[idx + needle.length]))
    ) {
      from = idx + 1;
      continue;
    }
    offsets.push(idx);
    from = idx + needle.length;
  }
  return offsets;
}

export function nextMatchIndex(count: number, current: number, direction: 1 | -1): number {
  if (count <= 0) return 0;
  return (current + direction + count) % count;
}

export type JumpTarget = {
  kind: "note" | "notebook" | "tag";
  id: string;
  title: string;
  subtitle: string;
};

export function jumpToMatches(
  query: string,
  notes: { id: string; title: string; notebook_name: string }[],
  notebooks: { id: string; name: string }[],
  tags: { id: string; name: string }[],
  limit = 12,
  kinds?: JumpKind[]
): JumpTarget[] {
  const needle = query.trim().toLowerCase();
  const matches = (text: string) => !needle || text.toLowerCase().includes(needle);
  const allow = (kind: JumpKind) => !kinds?.length || kinds.includes(kind);
  const results: JumpTarget[] = [];
  if (allow("notebook")) {
    for (const notebook of notebooks) {
      if (matches(notebook.name)) {
        results.push({
          kind: "notebook",
          id: notebook.id,
          title: notebook.name,
          subtitle: "Notebook",
        });
      }
    }
  }
  if (allow("tag")) {
    for (const tag of tags) {
      if (matches(tag.name)) {
        results.push({
          kind: "tag",
          id: tag.id,
          title: `#${tag.name}`,
          subtitle: "Tag",
        });
      }
    }
  }
  if (allow("note")) {
    for (const note of notes) {
      if (matches(note.title) || matches(note.notebook_name)) {
        results.push({
          kind: "note",
          id: note.id,
          title: note.title || "Untitled",
          subtitle: note.notebook_name,
        });
      }
    }
  }
  return results.slice(0, limit);
}

export function snippetParts(
  text: string,
  query: string
): { text: string; hit: boolean }[] {
  const needle = query.trim();
  if (!needle || !text) return [{ text, hit: false }];
  const offsets = findMatchOffsets(text, needle);
  if (!offsets.length) return [{ text, hit: false }];
  const parts: { text: string; hit: boolean }[] = [];
  let cursor = 0;
  for (const start of offsets) {
    if (start > cursor) parts.push({ text: text.slice(cursor, start), hit: false });
    parts.push({ text: text.slice(start, start + needle.length), hit: true });
    cursor = start + needle.length;
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor), hit: false });
  return parts;
}

export const RECENT_SEARCHES_KEY = "notebook.recentSearches";
export const RECENT_SEARCH_LIMIT = 8;

export function parseRecentSearches(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, RECENT_SEARCH_LIMIT);
  } catch {
    return [];
  }
}

export function rememberSearch(history: string[], query: string, limit = RECENT_SEARCH_LIMIT): string[] {
  const cleaned = query.trim();
  if (!cleaned) return history;
  return [cleaned, ...history.filter((item) => item.toLowerCase() !== cleaned.toLowerCase())].slice(
    0,
    limit
  );
}

export type NoteListFacet =
  | "reminder"
  | "attachment"
  | "untagged"
  | "image"
  | "url"
  | "checklist";

export function toggleListFacet(
  current: NoteListFacet[],
  facet: NoteListFacet
): NoteListFacet[] {
  return current.includes(facet)
    ? current.filter((item) => item !== facet)
    : [...current, facet];
}

export function noteMatchesFacets(
  note: { reminder_at: string | null; attachment_count: number },
  facets: NoteListFacet[]
): boolean {
  if (facets.includes("reminder") && !note.reminder_at) return false;
  if (facets.includes("attachment") && note.attachment_count <= 0) return false;
  return true;
}

function startOfLocalDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

export type DateRangeFacet = "any" | "today" | "week" | "month";

export function noteMatchesDateRange(
  iso: string,
  range: DateRangeFacet,
  now = new Date()
): boolean {
  if (range === "any") return true;
  const stamp = new Date(iso).getTime();
  if (Number.isNaN(stamp)) return false;
  const today = startOfLocalDay(now);
  if (range === "today") return stamp >= today;
  if (range === "week") return stamp >= today - 7 * 86_400_000;
  return stamp >= today - 30 * 86_400_000;
}

export type ParsedSearch = {
  text: string;
  notebook?: string;
  tag?: string;
  intitle?: string;
  reminder?: boolean;
  todo?: boolean;
};

const SEARCH_OPERATOR = /(?:^|\s)(notebook|tag|intitle|reminder|todo):(?:"([^"]*)"|(\S+))/gi;

export function parseSearchQuery(raw: string): ParsedSearch {
  const parsed: ParsedSearch = { text: raw };
  const leftover = raw.replace(SEARCH_OPERATOR, (_match, key, quoted, bare) => {
    const value = (quoted ?? bare ?? "").trim();
    const name = String(key).toLowerCase();
    if (name === "notebook" && value) parsed.notebook = value;
    if (name === "tag" && value) parsed.tag = value.replace(/^#/, "");
    if (name === "intitle" && value) parsed.intitle = value;
    if (name === "reminder") parsed.reminder = !/^(false|no|0)$/i.test(value);
    if (name === "todo") parsed.todo = !/^(false|no|0)$/i.test(value);
    return " ";
  });
  parsed.text = leftover.replace(/\s+/g, " ").trim();
  return parsed;
}

export function noteMatchesSearchOperators(
  note: {
    title: string;
    notebook_name: string;
    tag_names: string[];
    reminder_at: string | null;
    checklist_total?: number;
  },
  parsed: ParsedSearch
): boolean {
  if (
    parsed.notebook &&
    !note.notebook_name.toLowerCase().includes(parsed.notebook.toLowerCase())
  ) {
    return false;
  }
  if (
    parsed.tag &&
    !note.tag_names.some((tag) => tag.toLowerCase().includes(parsed.tag!.toLowerCase()))
  ) {
    return false;
  }
  if (parsed.intitle && !note.title.toLowerCase().includes(parsed.intitle.toLowerCase())) {
    return false;
  }
  if (parsed.reminder === true && !note.reminder_at) return false;
  if (parsed.reminder === false && note.reminder_at) return false;
  if (parsed.todo === true && !(note.checklist_total || 0)) return false;
  if (parsed.todo === false && (note.checklist_total || 0) > 0) return false;
  return true;
}

export const SAVED_SEARCHES_KEY = "notebook.savedSearches";

export type SavedSearch = { id: string; name: string; query: string };

export function parseSavedSearches(raw: string | null): SavedSearch[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => item && typeof item.query === "string")
      .map((item) => ({
        id: typeof item.id === "string" && item.id ? item.id : `search-${item.query}`,
        name: String(item.name || item.query).trim() || item.query,
        query: String(item.query).trim(),
      }))
      .filter((item) => item.query);
  } catch {
    return [];
  }
}

export function upsertSavedSearch(list: SavedSearch[], query: string, name?: string): SavedSearch[] {
  const cleaned = query.trim();
  if (!cleaned) return list;
  const label = (name || cleaned).trim() || cleaned;
  const existing = list.findIndex((item) => item.query.toLowerCase() === cleaned.toLowerCase());
  const entry: SavedSearch = {
    id: existing >= 0 ? list[existing].id : `search-${Date.now()}`,
    name: label,
    query: cleaned,
  };
  if (existing >= 0) {
    const next = [...list];
    next[existing] = entry;
    return next;
  }
  return [entry, ...list].slice(0, 20);
}

export function deleteSavedSearch(list: SavedSearch[], id: string): SavedSearch[] {
  return list.filter((item) => item.id !== id);
}

export type PaletteAction = {
  id: string;
  label: string;
  hint?: string;
};

export function paletteMatches(query: string, actions: PaletteAction[], limit = 24): PaletteAction[] {
  const needle = query.trim().toLowerCase();
  return actions
    .filter((action) => !needle || action.label.toLowerCase().includes(needle) || action.hint?.toLowerCase().includes(needle))
    .slice(0, limit);
}

export type JumpKind = JumpTarget["kind"];

export type SearchResource = "image" | "attachment" | "pdf";

export function renameSavedSearch(
  list: SavedSearch[],
  id: string,
  name: string
): SavedSearch[] {
  const cleaned = name.trim();
  if (!cleaned) return list;
  return list.map((item) => (item.id === id ? { ...item, name: cleaned } : item));
}
