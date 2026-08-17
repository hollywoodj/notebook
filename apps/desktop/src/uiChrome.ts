export const SIDEBAR_MIN = 180;
export const SIDEBAR_MAX = 420;
export const LIST_MIN = 220;
export const LIST_MAX = 560;
export const DEFAULT_SIDEBAR_WIDTH = 248;
export const DEFAULT_LIST_WIDTH = 320;
export const PANE_LAYOUT_KEY = "notebook.paneLayout";
export const NOTE_DRAG_TYPE = "application/x-notebook-notes";

export interface PaneLayout {
  sidebarWidth: number;
  listWidth: number;
  sidebarCollapsed: boolean;
  listCollapsed: boolean;
}

export function clampPaneWidth(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

export function defaultPaneLayout(): PaneLayout {
  return {
    sidebarWidth: DEFAULT_SIDEBAR_WIDTH,
    listWidth: DEFAULT_LIST_WIDTH,
    sidebarCollapsed: false,
    listCollapsed: false,
  };
}

export function parsePaneLayout(raw: string | null): PaneLayout {
  const fallback = defaultPaneLayout();
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw) as Partial<PaneLayout>;
    return {
      sidebarWidth: clampPaneWidth(
        Number(parsed.sidebarWidth),
        SIDEBAR_MIN,
        SIDEBAR_MAX
      ),
      listWidth: clampPaneWidth(Number(parsed.listWidth), LIST_MIN, LIST_MAX),
      sidebarCollapsed: Boolean(parsed.sidebarCollapsed),
      listCollapsed: Boolean(parsed.listCollapsed),
    };
  } catch {
    return fallback;
  }
}

export function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).filter(Boolean).length;
}

export function findMatchOffsets(text: string, query: string): number[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const hay = text.toLowerCase();
  const offsets: number[] = [];
  let from = 0;
  while (from <= hay.length - needle.length) {
    const idx = hay.indexOf(needle, from);
    if (idx < 0) break;
    offsets.push(idx);
    from = idx + needle.length;
  }
  return offsets;
}

export function nextMatchIndex(count: number, current: number, direction: 1 | -1): number {
  if (count <= 0) return 0;
  return (current + direction + count) % count;
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

export function noteAppLink(id: string): string {
  return `notebook://note/${id}`;
}

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

export function suggestedTags(
  tags: { id: string; name: string }[],
  query: string,
  excludeIds: Iterable<string>
): { id: string; name: string }[] {
  const excluded = new Set(excludeIds);
  const needle = query.trim().toLowerCase();
  return tags
    .filter((tag) => !excluded.has(tag.id))
    .filter((tag) => !needle || tag.name.toLowerCase().includes(needle))
    .slice(0, 8);
}

export const EDITOR_COMMAND_EVENT = "notebook:editor-command";

export const HIGHLIGHT_COLORS = [
  { id: "yellow", label: "Yellow", color: "#fff3a0" },
  { id: "green", label: "Green", color: "#c6f6d5" },
  { id: "pink", label: "Pink", color: "#ffcce5" },
  { id: "blue", label: "Blue", color: "#cde4ff" },
] as const;

export const TEXT_COLORS = [
  { id: "default", label: "Default", color: "" },
  { id: "red", label: "Red", color: "#d64545" },
  { id: "orange", label: "Orange", color: "#d9822b" },
  { id: "green", label: "Green", color: "#00a82d" },
  { id: "blue", label: "Blue", color: "#2b6cb0" },
  { id: "purple", label: "Purple", color: "#6b46c1" },
] as const;

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
  limit = 12
): JumpTarget[] {
  const needle = query.trim().toLowerCase();
  const matches = (text: string) => !needle || text.toLowerCase().includes(needle);
  const results: JumpTarget[] = [];
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
  return results.slice(0, limit);
}

export type EditorCommand =
  | { type: "undo" | "redo" | "cut" | "copy" | "paste" | "selectAll" }
  | { type: "bold" | "italic" | "underline" | "strike" | "clear" }
  | { type: "highlight"; color?: string }
  | { type: "color"; color?: string }
  | { type: "horizontalRule" | "insertDate" | "insertTable" }
  | { type: "heading"; level: 1 | 2 | 3 }
  | { type: "bulletList" | "orderedList" | "taskList" | "blockquote" | "codeBlock" }
  | { type: "align"; align: "left" | "center" | "right" | "justify" }
  | { type: "indent" | "outdent" }
  | { type: "link"; href?: string; text?: string }
  | { type: "openLinkDialog" }
  | { type: "replace"; query: string; replacement: string; all?: boolean };

export function dispatchEditorCommand(command: EditorCommand) {
  window.dispatchEvent(new CustomEvent(EDITOR_COMMAND_EVENT, { detail: command }));
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

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function mergeNoteBodies(
  notes: { title: string; content: string }[]
): string {
  if (notes.length === 0) return "<p></p>";
  const [first, ...rest] = notes;
  const extra = rest.map((note) => {
    const heading = `<h1>${escapeHtml(note.title || "Untitled")}</h1>`;
    return `${heading}${note.content || ""}`;
  });
  return `${first.content || "<p></p>"}${extra.join("")}`;
}

export function toEnexTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

export function notesToHtmlDocument(title: string, content: string): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${escapeHtml(title || "Untitled")}</title></head>
<body><h1>${escapeHtml(title || "Untitled")}</h1>${content}</body></html>`;
}

export function notesToEnex(
  notes: {
    title: string;
    content: string;
    created_at: string;
    updated_at: string;
    tag_names?: string[];
  }[]
): string {
  const body = notes
    .map((note) => {
      const enml = `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE en-note SYSTEM "http://xml.evernote.com/pub/enml2.dtd"><en-note>${note.content}</en-note>`;
      const tags = (note.tag_names || [])
        .map((tag) => `<tag>${escapeHtml(tag)}</tag>`)
        .join("");
      return `<note><title>${escapeHtml(note.title || "Untitled")}</title><content><![CDATA[${enml}]]></content><created>${toEnexTimestamp(note.created_at)}</created><updated>${toEnexTimestamp(note.updated_at)}</updated>${tags}</note>`;
    })
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE en-export SYSTEM "http://xml.evernote.com/pub/evernote-export3.dtd"><en-export>${body}</en-export>`;
}

export function downloadTextFile(filename: string, text: string, mime: string) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function safeFilename(title: string): string {
  const cleaned = (title || "Untitled").replace(/[\\/:*?"<>|]+/g, " ").trim();
  return cleaned || "Untitled";
}

export const EDITOR_CHROME_KEY = "notebook.editorChrome";
export const ZOOM_MIN = 50;
export const ZOOM_MAX = 200;
export const ZOOM_STEP = 10;
export const DEFAULT_ZOOM = 100;

export interface EditorChrome {
  toolbarHidden: boolean;
  attachmentsExpanded: boolean;
  zoom: number;
}

export function defaultEditorChrome(): EditorChrome {
  return { toolbarHidden: false, attachmentsExpanded: false, zoom: DEFAULT_ZOOM };
}

export function formattingToolbarVisible(
  toolbarHidden: boolean,
  editorFocused: boolean
): boolean {
  return !toolbarHidden && editorFocused;
}

export function attachmentsLabel(count: number): string {
  return count === 1 ? "1 attachment" : `${count} attachments`;
}

export function clampZoom(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_ZOOM;
  const stepped = Math.round(value / ZOOM_STEP) * ZOOM_STEP;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, stepped));
}

export function parseEditorChrome(raw: string | null): EditorChrome {
  const fallback = defaultEditorChrome();
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw) as Partial<EditorChrome>;
    return {
      toolbarHidden: Boolean(parsed.toolbarHidden),
      attachmentsExpanded: Boolean(parsed.attachmentsExpanded),
      zoom: clampZoom(Number(parsed.zoom ?? DEFAULT_ZOOM)),
    };
  } catch {
    return fallback;
  }
}

export function nextZoom(current: number, direction: 1 | -1 | 0): number {
  if (direction === 0) return DEFAULT_ZOOM;
  return clampZoom(current + direction * ZOOM_STEP);
}

export function windowTitleForNote(noteTitle: string | null): string {
  if (noteTitle === null) return "Notebook";
  const cleaned = noteTitle.trim() || "Untitled";
  return `${cleaned} – Notebook`;
}

export type EmptyView =
  | "all"
  | "notebook"
  | "tag"
  | "shortcuts"
  | "reminders"
  | "templates"
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

export function matchesSidebarFilter(name: string, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return name.toLowerCase().includes(needle);
}

export function notebooksMatchingFilter<T extends { name: string }>(
  notebooks: T[],
  stackName: string | null,
  query: string
): T[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return notebooks;
  if (stackName && stackName.toLowerCase().includes(needle)) return notebooks;
  return notebooks.filter((notebook) => notebook.name.toLowerCase().includes(needle));
}

export function hasVisibleSidebarNotebooks(
  notebooks: { name: string }[],
  stacks: { name: string }[],
  query: string
): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return notebooks.length > 0;
  if (stacks.some((stack) => stack.name.toLowerCase().includes(needle))) return true;
  return notebooks.some((notebook) => notebook.name.toLowerCase().includes(needle));
}
