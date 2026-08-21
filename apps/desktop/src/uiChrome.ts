export const SIDEBAR_MIN = 180;
export const SIDEBAR_MAX = 420;
export const LIST_MIN = 220;
export const LIST_MAX = 560;
export const DEFAULT_SIDEBAR_WIDTH = 248;
export const DEFAULT_LIST_WIDTH = 320;
/** Evernote’s collapsed left sidebar is a 56px icon rail. */
export const SIDEBAR_RAIL_WIDTH = 56;
/** Sidebar nav glyphs. Evernote’s are ~20px; 16px reads undersized in the rail. */
export const SIDEBAR_NAV_ICON_SIZE = 20;
export const PANE_LAYOUT_KEY = "notebook.paneLayout";
export const NOTE_DRAG_TYPE = "application/x-notebook-notes";
export const NOTE_TAB_DRAG_TYPE = "application/x-notebook-tab";

export function newNoteTabId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `tab-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function createNoteTab(init?: { noteId?: string | null; title?: string }): {
  id: string;
  noteId: string | null;
  title: string;
} {
  const noteId = init?.noteId ?? null;
  return {
    id: newNoteTabId(),
    noteId,
    title: noteTabLabel(init?.title, Boolean(noteId)),
  };
}

export function noteTabLabel(title: string | null | undefined, hasNote: boolean): string {
  if (!hasNote) return "Notes";
  const cleaned = (title || "").trim();
  return cleaned || "Untitled";
}

export function nextActiveTabId(
  tabIds: string[],
  closingId: string,
  activeId: string
): string | null {
  if (tabIds.length <= 1) return tabIds[0] ?? null;
  const remaining = tabIds.filter((id) => id !== closingId);
  if (!remaining.length) return null;
  if (activeId !== closingId && remaining.includes(activeId)) return activeId;
  const index = tabIds.indexOf(closingId);
  const fallback = Math.min(Math.max(index, 0), remaining.length - 1);
  return remaining[fallback] ?? remaining[0];
}

export function reorderById<T extends { id: string }>(
  items: T[],
  fromId: string,
  toId: string
): T[] {
  const from = items.findIndex((item) => item.id === fromId);
  const to = items.findIndex((item) => item.id === toId);
  if (from < 0 || to < 0 || from === to) return items;
  const next = [...items];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

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

export function isNoteExpanded(layout: PaneLayout): boolean {
  return layout.sidebarCollapsed && layout.listCollapsed;
}

export function toggleNoteListHidden(layout: PaneLayout): PaneLayout {
  if (isNoteExpanded(layout)) {
    return { ...layout, sidebarCollapsed: false, listCollapsed: false };
  }
  return { ...layout, listCollapsed: !layout.listCollapsed };
}

export function toggleNoteExpanded(layout: PaneLayout): PaneLayout {
  if (isNoteExpanded(layout)) {
    return { ...layout, sidebarCollapsed: false, listCollapsed: false };
  }
  return { ...layout, sidebarCollapsed: true, listCollapsed: true };
}

/**
 * Resizes the sidebar to the dragged edge position. Tracking the pointer rather
 * than accumulating deltas keeps the width aligned with the splitter as it moves.
 */
export function resizeSidebarTo(layout: PaneLayout, edge: number): PaneLayout {
  return {
    ...layout,
    sidebarCollapsed: false,
    sidebarWidth: clampPaneWidth(edge, SIDEBAR_MIN, SIDEBAR_MAX),
  };
}

export function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).filter(Boolean).length;
}

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

export function adjacentNoteId<T extends { id: string }>(
  notes: T[],
  currentId: string | null,
  direction: -1 | 1
): string | null {
  return noteIdByOffset(notes, currentId, direction);
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
  { id: "orange", label: "Orange", color: "#ffd8a8" },
  { id: "purple", label: "Purple", color: "#e9d5ff" },
  { id: "gray", label: "Gray", color: "#e2e8f0" },
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

export type JumpKind = JumpTarget["kind"];

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

export type EditorCommand =
  | { type: "undo" | "redo" | "cut" | "copy" | "paste" | "pastePlain" | "selectAll" }
  | { type: "bold" | "italic" | "underline" | "strike" | "clear" }
  | { type: "highlight"; color?: string }
  | { type: "color"; color?: string }
  | { type: "horizontalRule" | "insertDate" | "insertTime" | "insertDateTime" | "insertTable" | "insertToc" }
  | { type: "heading"; level: 1 | 2 | 3 }
  | { type: "bulletList" | "orderedList" | "taskList" | "blockquote" | "codeBlock" | "inlineCode" | "inlineCheckbox" }
  | { type: "align"; align: "left" | "center" | "right" | "justify" }
  | { type: "indent" | "outdent" }
  | { type: "link"; href?: string; text?: string }
  | { type: "openLinkDialog" | "unlink" }
  | { type: "fontFamily"; family?: string }
  | { type: "fontSize"; size?: string }
  | { type: "fontSizeStep"; direction: 1 | -1 }
  | { type: "findNext" | "findPrev" }
  | { type: "imageSize"; width?: string }
  | { type: "imageCaption"; title?: string }
  | { type: "imageAlign"; align: "left" | "center" | "right" }
  | { type: "tasks"; action: "checkAll" | "uncheckAll" }
  | { type: "unsetColor" }
  | {
      type: "tableAction";
      action: "insert" | "addRow" | "addColumn" | "deleteRow" | "deleteColumn" | "deleteTable";
    }
  | { type: "superscript" | "subscript" }
  | { type: "callout"; kind?: "info" | "warning" | "tip" }
  | { type: "replace"; query: string; replacement: string; all?: boolean };

export function dispatchEditorCommand(command: EditorCommand) {
  window.dispatchEvent(new CustomEvent(EDITOR_COMMAND_EVENT, { detail: command }));
}

export type NoteListGroup<T> = { key: string; label: string; notes: T[] };

function startOfLocalDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
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

export function groupNotesForList<
  T extends {
    is_pinned: boolean;
    created_at: string;
    updated_at: string;
    reminder_at?: string | null;
  },
>(
  notes: T[],
  sortBy: "updated" | "created" | "title" | "reminder",
  now = new Date()
): NoteListGroup<T>[] {
  if (sortBy === "reminder") {
    return groupNotesByReminder(notes, now);
  }
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

export const LINE_HEIGHTS = [1, 1.15, 1.5, 2] as const;
export type LineHeight = (typeof LINE_HEIGHTS)[number];

export interface EditorChrome {
  toolbarHidden: boolean;
  attachmentsExpanded: boolean;
  zoom: number;
  outlineOpen: boolean;
  statusBarHidden: boolean;
  lineHeight: LineHeight;
}

export function defaultEditorChrome(): EditorChrome {
  return {
    toolbarHidden: false,
    attachmentsExpanded: false,
    zoom: DEFAULT_ZOOM,
    outlineOpen: false,
    statusBarHidden: false,
    lineHeight: 1.5,
  };
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

export function parseLineHeight(value: unknown): LineHeight {
  const numeric = Number(value);
  return (LINE_HEIGHTS as readonly number[]).includes(numeric)
    ? (numeric as LineHeight)
    : 1.5;
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
      outlineOpen: Boolean(parsed.outlineOpen),
      statusBarHidden: Boolean(parsed.statusBarHidden),
      lineHeight: parseLineHeight(parsed.lineHeight),
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
  | "search"
  | "archived";

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
    case "archived":
      return {
        title: "No archived notes",
        body: "Archive a note to tuck it out of All Notes without sending it to Trash.",
      };
    default:
      return {
        title: "Create your first note",
        body: "Click New note to capture an idea, meeting, or anything else.",
      };
  }
}

/** Sidebar sections whose contents open in a panel beside the sidebar. */
export type SidebarFlyoutKind = "shortcuts" | "notebooks" | "tags";
export type SidebarFlyout = SidebarFlyoutKind | null;

/** Clicking the section that is already open closes its panel. */
export function nextSidebarFlyout(
  current: SidebarFlyout,
  clicked: SidebarFlyoutKind
): SidebarFlyout {
  return current === clicked ? null : clicked;
}

export function sidebarFlyoutTitle(kind: SidebarFlyoutKind): string {
  if (kind === "shortcuts") return "Shortcuts";
  if (kind === "notebooks") return "Notebooks";
  return "Tags";
}

export function sidebarFilterLabel(kind: SidebarFlyoutKind): string {
  return kind === "tags" ? "Filter tags" : "Filter notebooks";
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

export const TOOLBAR_OVERFLOW_WIDTH = 34;

/** How many leading toolbar items fit before the rest move into `…`. */
export function visibleToolbarCount(
  availableWidth: number,
  itemWidths: number[],
  overflowWidth = TOOLBAR_OVERFLOW_WIDTH
): number {
  if (itemWidths.length === 0) return 0;
  const total = itemWidths.reduce((sum, width) => sum + width, 0);
  if (total <= availableWidth) return itemWidths.length;
  const budget = Math.max(0, availableWidth - overflowWidth);
  let used = 0;
  let count = 0;
  for (const width of itemWidths) {
    if (used + width > budget) break;
    used += width;
    count += 1;
  }
  return count;
}

export const EDITOR_FONTS = [
  { id: "", label: "Default" },
  { id: "Arial, sans-serif", label: "Sans Serif" },
  { id: "Georgia, \"Times New Roman\", serif", label: "Serif" },
  { id: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace", label: "Monospace" },
  { id: "Trebuchet MS, sans-serif", label: "Trebuchet" },
  { id: "Verdana, sans-serif", label: "Verdana" },
] as const;

export const EDITOR_FONT_SIZES = [12, 14, 16, 18, 24, 32, 48] as const;

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

export function noteHasUrl(note: {
  source_url?: string | null;
  snippet?: string;
}): boolean {
  if (note.source_url?.trim()) return true;
  return /\bhttps?:\/\//i.test(note.snippet || "");
}

export function noteMatchesFacets(
  note: {
    reminder_at: string | null;
    attachment_count: number;
    tag_names?: string[];
    thumbnail_url?: string | null;
    source_url?: string | null;
    snippet?: string;
    checklist_total?: number;
  },
  facets: NoteListFacet[]
): boolean {
  if (facets.includes("reminder") && !note.reminder_at) return false;
  if (facets.includes("attachment") && note.attachment_count <= 0) return false;
  if (facets.includes("untagged") && (note.tag_names?.length ?? 0) > 0) return false;
  if (facets.includes("image") && !note.thumbnail_url) return false;
  if (facets.includes("url") && !noteHasUrl(note)) return false;
  if (facets.includes("checklist") && (note.checklist_total || 0) <= 0) return false;
  return true;
}

export function hasActiveListFilters(
  facets: NoteListFacet[],
  range: DateRangeFacet
): boolean {
  return facets.length > 0 || range !== "any";
}

export function checklistProgressLabel(done: number, total: number): string | null {
  if (!Number.isFinite(done) || !Number.isFinite(total) || total <= 0) return null;
  return `${Math.max(0, Math.round(done))}/${Math.max(0, Math.round(total))}`;
}

export function attachmentCountLabel(count: number): string | null {
  if (!Number.isFinite(count) || count <= 0) return null;
  return count === 1 ? "1 attachment" : `${Math.round(count)} attachments`;
}

const AVATAR_COLORS = ["#00a82d", "#2b6cb0", "#d64545", "#d9822b", "#6b46c1", "#0f9d8e"];

export function avatarColor(name: string): string {
  const source = name.trim() || "?";
  let hash = 0;
  for (let i = 0; i < source.length; i++) {
    hash = (hash * 31 + source.charCodeAt(i)) | 0;
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

export const COLLAPSED_STACKS_KEY = "notebook.collapsedStacks";

export function parseCollapsedStacks(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is string => typeof id === "string" && id.length > 0);
  } catch {
    return [];
  }
}

export function toggleCollapsedId(ids: string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id];
}

export function collapseAllIds(allIds: string[]): string[] {
  return [...new Set(allIds.filter(Boolean))];
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function resolveThumbnailUrl(
  raw: string | null | undefined,
  toAttachmentUrl: (id: string) => string
): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const attached = trimmed.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
  if (UUID_RE.test(trimmed) && attached) return toAttachmentUrl(attached[1]);
  if (trimmed.startsWith("notebook-attachment://") && attached) {
    return toAttachmentUrl(attached[1]);
  }
  return trimmed;
}

export type SnoozePreset = "laterToday" | "tomorrowMorning";

export function reminderFromSnooze(kind: SnoozePreset, now = new Date()): string {
  if (kind === "tomorrowMorning") return reminderFromPreset("tomorrow", now);
  const later = new Date(now.getTime() + 3 * 60 * 60 * 1000);
  return later.toISOString();
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

export type SearchResource = "image" | "attachment" | "pdf";

export type ParsedSearch = {
  text: string;
  notebook?: string;
  tag?: string;
  intitle?: string;
  reminder?: boolean;
  todo?: boolean;
  created?: DateRangeFacet;
  updated?: DateRangeFacet;
  resource?: SearchResource;
  untagged?: boolean;
  minus: string[];
};

const SEARCH_OPERATOR =
  /(?:^|\s)(notebook|tag|intitle|reminder|todo|created|updated|resource|untagged):(?:"([^"]*)"|(\S+))/gi;

function parseDateRangeToken(value: string): DateRangeFacet | undefined {
  const token = value.trim().toLowerCase();
  if (token === "today") return "today";
  if (token === "week" || token === "thisweek") return "week";
  if (token === "month" || token === "thismonth") return "month";
  return undefined;
}

function parseResourceToken(value: string): SearchResource | undefined {
  const token = value.trim().toLowerCase();
  if (token === "image" || token === "images" || token === "img") return "image";
  if (token === "pdf" || token === "pdfs") return "pdf";
  if (token === "attachment" || token === "file" || token === "true") return "attachment";
  return undefined;
}

export function parseSearchQuery(raw: string): ParsedSearch {
  const parsed: ParsedSearch = { text: raw, minus: [] };
  const leftover = raw.replace(SEARCH_OPERATOR, (_match, key, quoted, bare) => {
    const value = (quoted ?? bare ?? "").trim();
    const name = String(key).toLowerCase();
    if (name === "notebook" && value) parsed.notebook = value;
    if (name === "tag" && value) parsed.tag = value.replace(/^#/, "");
    if (name === "intitle" && value) parsed.intitle = value;
    if (name === "reminder") parsed.reminder = !/^(false|no|0)$/i.test(value);
    if (name === "todo") parsed.todo = !/^(false|no|0)$/i.test(value);
    if (name === "created") parsed.created = parseDateRangeToken(value) || "any";
    if (name === "updated") parsed.updated = parseDateRangeToken(value) || "any";
    if (name === "resource") parsed.resource = parseResourceToken(value);
    if (name === "untagged") parsed.untagged = !/^(false|no|0)$/i.test(value);
    return " ";
  });
  const tokens = leftover.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const kept: string[] = [];
  for (const token of tokens) {
    if (token.startsWith("-") && token.length > 1) {
      parsed.minus.push(token.slice(1));
    } else {
      kept.push(token);
    }
  }
  parsed.text = kept.join(" ");
  return parsed;
}

export function noteMatchesSearchOperators(
  note: {
    title: string;
    notebook_name: string;
    tag_names: string[];
    reminder_at: string | null;
    created_at?: string;
    updated_at?: string;
    attachment_count?: number;
    thumbnail_url?: string | null;
    snippet?: string;
    checklist_total?: number;
  },
  parsed: ParsedSearch,
  now = new Date()
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
  if (parsed.untagged === true && note.tag_names.length > 0) return false;
  if (parsed.untagged === false && note.tag_names.length === 0) return false;
  if (parsed.created && parsed.created !== "any") {
    if (!note.created_at || !noteMatchesDateRange(note.created_at, parsed.created, now)) {
      return false;
    }
  }
  if (parsed.updated && parsed.updated !== "any") {
    if (!note.updated_at || !noteMatchesDateRange(note.updated_at, parsed.updated, now)) {
      return false;
    }
  }
  if (parsed.resource === "attachment" && !(note.attachment_count || 0)) return false;
  if (parsed.resource === "image") {
    const blob = `${note.thumbnail_url || ""} ${note.snippet || ""}`.toLowerCase();
    if (!blob.includes("<img") && !note.thumbnail_url) return false;
  }
  if (parsed.resource === "pdf") {
    const blob = `${note.snippet || ""} ${note.title || ""}`.toLowerCase();
    if (!blob.includes("pdf") && !(note.attachment_count || 0)) return false;
  }
  const hay = `${note.title} ${note.snippet || ""} ${note.notebook_name} ${note.tag_names.join(" ")}`.toLowerCase();
  for (const term of parsed.minus) {
    if (hay.includes(term.toLowerCase())) return false;
  }
  return true;
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

export function htmlToPlainText(html: string): string {
  return decodeHtmlEntities(
    html
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n")
      .replace(/<\/h[1-6]>/gi, "\n")
      .replace(/<\/li>/gi, "\n")
      .replace(/<[^>]+>/g, "")
  )
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function htmlToMarkdown(html: string): string {
  let text = html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "");
  text = text.replace(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi, (_m, inner) => `# ${htmlToPlainText(inner)}\n\n`);
  text = text.replace(/<h2\b[^>]*>([\s\S]*?)<\/h2>/gi, (_m, inner) => `## ${htmlToPlainText(inner)}\n\n`);
  text = text.replace(/<h3\b[^>]*>([\s\S]*?)<\/h3>/gi, (_m, inner) => `### ${htmlToPlainText(inner)}\n\n`);
  text = text.replace(/<strong\b[^>]*>([\s\S]*?)<\/strong>/gi, "**$1**");
  text = text.replace(/<b\b[^>]*>([\s\S]*?)<\/b>/gi, "**$1**");
  text = text.replace(/<em\b[^>]*>([\s\S]*?)<\/em>/gi, "*$1*");
  text = text.replace(/<i\b[^>]*>([\s\S]*?)<\/i>/gi, "*$1*");
  text = text.replace(
    /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
    (_m, href, inner) => `[${htmlToPlainText(inner) || href}](${href})`
  );
  text = text.replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, "`$1`");
  text = text.replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, (_m, inner) => `- ${htmlToPlainText(inner)}\n`);
  text = text.replace(/<blockquote\b[^>]*>([\s\S]*?)<\/blockquote>/gi, (_m, inner) =>
    htmlToPlainText(inner)
      .split("\n")
      .map((line) => `> ${line}`)
      .join("\n")
  );
  text = text.replace(
    /<div\b[^>]*data-callout=["']([^"']+)["'][^>]*>([\s\S]*?)<\/div>/gi,
    (_m, kind, inner) => `> [!${String(kind).toUpperCase()}]\n> ${htmlToPlainText(inner)}\n\n`
  );
  text = text.replace(/<br\s*\/?>/gi, "\n");
  text = text.replace(/<hr\b[^>]*>/gi, "\n---\n");
  text = text.replace(/<p\b[^>]*>([\s\S]*?)<\/p>/gi, "$1\n\n");
  text = htmlToPlainText(`<p>${text}</p>`).replace(/\n{3,}/g, "\n\n").trim();
  return text;
}

export type OutlineHeading = { level: 1 | 2 | 3; text: string; pos?: number };

export function headingsFromHtml(html: string): OutlineHeading[] {
  const headings: OutlineHeading[] = [];
  const matches = html.matchAll(/<h([1-3])\b[^>]*>([\s\S]*?)<\/h\1>/gi);
  for (const match of matches) {
    const level = Number(match[1]) as 1 | 2 | 3;
    const text = htmlToPlainText(match[2] || "");
    if (text) headings.push({ level, text });
  }
  return headings;
}

export async function copyTextToClipboard(text: string, html?: string) {
  if (html && "ClipboardItem" in window && navigator.clipboard.write) {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/plain": new Blob([text], { type: "text/plain" }),
          "text/html": new Blob([html], { type: "text/html" }),
        }),
      ]);
      return;
    } catch {
      // Fall through to plain text.
    }
  }
  await navigator.clipboard.writeText(text);
}

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

export function noteMailtoHref(title: string, plain: string): string {
  const subject = encodeURIComponent(title.trim() || "Untitled");
  const body = encodeURIComponent(plain.trim() || "");
  return `mailto:?subject=${subject}&body=${body}`;
}

export const CODE_LANGUAGES = [
  { id: "", label: "Plain text" },
  { id: "javascript", label: "JavaScript" },
  { id: "typescript", label: "TypeScript" },
  { id: "python", label: "Python" },
  { id: "rust", label: "Rust" },
  { id: "json", label: "JSON" },
  { id: "html", label: "HTML" },
  { id: "css", label: "CSS" },
  { id: "shell", label: "Shell" },
] as const;

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

export function countCharacters(text: string): number {
  return text.replace(/\s+/g, " ").trim().length;
}

export function readingTimeLabel(wordCount: number): string | null {
  if (!Number.isFinite(wordCount) || wordCount <= 0) return null;
  const minutes = Math.max(1, Math.round(wordCount / 200));
  return minutes === 1 ? "1 min read" : `${minutes} min read`;
}

export function insertDateStamp(now = new Date()): string {
  return now.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function insertTimeStamp(now = new Date()): string {
  return now.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

export function nextFontSize(current: string | undefined, direction: 1 | -1): string {
  const sizes = [...EDITOR_FONT_SIZES];
  const parsed = Number.parseInt(String(current || ""), 10);
  const fallback = 16;
  const value = Number.isFinite(parsed) ? parsed : fallback;
  let index = sizes.findIndex((size) => size >= value);
  if (index < 0) index = sizes.length - 1;
  if (sizes[index] !== value && direction < 0) index = Math.max(0, index - 1);
  const next = sizes[Math.min(sizes.length - 1, Math.max(0, index + direction))];
  return `${next}px`;
}

export const IMAGE_SIZE_PRESETS = [
  { id: "small", label: "Small", width: "25%" },
  { id: "medium", label: "Medium", width: "50%" },
  { id: "large", label: "Large", width: "75%" },
  { id: "original", label: "Original", width: "" },
] as const;

export function outlineToHtml(headings: { level: number; text: string }[]): string {
  if (!headings.length) return "";
  const items = headings
    .map((heading) => {
      const pad = "&nbsp;".repeat(Math.max(0, heading.level - 1) * 4);
      return `<li>${pad}${escapeHtml(heading.text)}</li>`;
    })
    .join("");
  return `<h2>Table of Contents</h2><ul>${items}</ul>`;
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

export function printHtmlDocument(title: string, content: string) {
  const html = notesToHtmlDocument(title, content);
  const frame = window.open("", "_blank", "noopener,noreferrer");
  if (!frame) {
    window.print();
    return;
  }
  frame.document.write(html);
  frame.document.title = title || "Untitled";
  frame.document.close();
  frame.focus();
  window.setTimeout(() => frame.print(), 50);
}

export function trashToastCopy(count: number, title: string): string {
  if (count > 1) return `${count} notes moved to Trash`;
  const cleaned = title.trim() || "Untitled";
  return `“${cleaned}” moved to Trash`;
}

export const CLOSED_TABS_LIMIT = 12;

export function rememberClosedTab<T>(stack: T[], closed: T, limit = CLOSED_TABS_LIMIT): T[] {
  return [closed, ...stack].slice(0, limit);
}

export function popClosedTab<T>(stack: T[]): { item: T; remaining: T[] } | null {
  if (!stack.length) return null;
  return { item: stack[0], remaining: stack.slice(1) };
}

export function closeOtherTabIds(tabIds: string[], keepId: string): string[] {
  return tabIds.filter((id) => id !== keepId);
}

export function closeTabsToTheRight(tabIds: string[], fromId: string): string[] {
  const index = tabIds.indexOf(fromId);
  if (index < 0) return [];
  return tabIds.slice(index + 1);
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
  if (filter.type === "search") return `Search: ${filter.query || ""}`;
  return "Notes";
}

export function plaintextFromClipboardHtml(html: string): string {
  return htmlToPlainText(html).replace(/\n/g, "<br>");
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

export function navCountLabel(count: number | null | undefined): string {
  return typeof count === "number" && Number.isFinite(count) ? String(Math.round(count)) : "";
}

export function navIconTitle(label: string, count?: number | null): string {
  return typeof count === "number" && Number.isFinite(count)
    ? `${label} (${Math.round(count)})`
    : label;
}

export function listCountLabel(visible: number, total: number, loaded = true): string {
  if (!loaded) return "";
  const count = visible === 1 ? "1 note" : `${visible} notes`;
  if (visible === total || total <= 0) return count;
  return `${count} of ${total}`;
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

/** Prefer a known sidebar/metadata count over a stale "0 notes" while a view loads. */
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

export function stickyNavCount(
  current: number,
  previous: number | null | undefined
): number | undefined {
  if (current > 0) return current;
  if (typeof previous === "number") return previous;
  return undefined;
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

export function nextLineHeight(current: LineHeight, direction: 1 | -1): LineHeight {
  const index = LINE_HEIGHTS.indexOf(current);
  const next = Math.min(LINE_HEIGHTS.length - 1, Math.max(0, index + direction));
  return LINE_HEIGHTS[next];
}

export const SPELLCHECK_LANGUAGES = [
  { id: "en-US", label: "English (US)" },
  { id: "en-GB", label: "English (UK)" },
  { id: "de-DE", label: "German" },
  { id: "fr-FR", label: "French" },
  { id: "es-ES", label: "Spanish" },
  { id: "it-IT", label: "Italian" },
  { id: "pt-BR", label: "Portuguese (Brazil)" },
  { id: "nl-NL", label: "Dutch" },
  { id: "pl-PL", label: "Polish" },
  { id: "ru-RU", label: "Russian" },
  { id: "ja-JP", label: "Japanese" },
  { id: "zh-CN", label: "Chinese (Simplified)" },
  { id: "ko-KR", label: "Korean" },
] as const;

export const NOTE_COLORS = [
  { id: "", label: "None", swatch: "transparent" },
  { id: "red", label: "Red", swatch: "#f97066" },
  { id: "orange", label: "Orange", swatch: "#f79009" },
  { id: "yellow", label: "Yellow", swatch: "#f4c430" },
  { id: "green", label: "Green", swatch: "#00a82d" },
  { id: "blue", label: "Blue", swatch: "#2e90fa" },
  { id: "purple", label: "Purple", swatch: "#7a5af8" },
] as const;

export type NoteColorId = (typeof NOTE_COLORS)[number]["id"];

export const NOTE_COLORS_KEY = "notebook.noteColors";
export const LOCKED_NOTES_KEY = "notebook.lockedNotes";
export const RECENT_NOTES_KEY = "notebook.recentNotes";
export const SIDEBAR_SECTIONS_KEY = "notebook.sidebarSections";

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

export function parseIdList(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item) => typeof item === "string");
  } catch {
    return [];
  }
}

export function parseNoteColorMap(raw: string | null): Record<string, string> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const next: Record<string, string> = {};
    for (const [id, value] of Object.entries(parsed)) {
      if (typeof value === "string" && NOTE_COLORS.some((color) => color.id === value && value)) {
        next[id] = value;
      }
    }
    return next;
  } catch {
    return {};
  }
}

export function setNoteColor(
  map: Record<string, string>,
  id: string,
  color: string
): Record<string, string> {
  const next = { ...map };
  if (!color) delete next[id];
  else next[id] = color;
  return next;
}

export const DEFAULT_SIDEBAR_SECTIONS = [
  "notes",
  "shortcuts",
  "reminders",
  "notebooks",
  "tags",
  "templates",
  "archived",
  "saved",
  "trash",
] as const;

export type SidebarSectionId = (typeof DEFAULT_SIDEBAR_SECTIONS)[number];

export function parseSidebarSections(raw: string | null): SidebarSectionId[] {
  const fallback = [...DEFAULT_SIDEBAR_SECTIONS];
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return fallback;
    const allowed = new Set<string>(DEFAULT_SIDEBAR_SECTIONS);
    const seen = new Set<string>();
    const ordered: SidebarSectionId[] = [];
    for (const item of parsed) {
      if (typeof item === "string" && allowed.has(item) && !seen.has(item)) {
        ordered.push(item as SidebarSectionId);
        seen.add(item);
      }
    }
    for (const item of DEFAULT_SIDEBAR_SECTIONS) {
      if (!seen.has(item)) ordered.push(item);
    }
    return ordered;
  } catch {
    return fallback;
  }
}

export function moveSidebarSection(
  sections: SidebarSectionId[],
  id: SidebarSectionId,
  direction: -1 | 1
): SidebarSectionId[] {
  const index = sections.indexOf(id);
  if (index < 0) return sections;
  const nextIndex = index + direction;
  if (nextIndex < 0 || nextIndex >= sections.length) return sections;
  const next = [...sections];
  const [item] = next.splice(index, 1);
  next.splice(nextIndex, 0, item);
  return next;
}

export function sidebarSectionLabel(id: SidebarSectionId): string {
  const labels: Record<SidebarSectionId, string> = {
    notes: "Notes",
    shortcuts: "Shortcuts",
    reminders: "Reminders",
    notebooks: "Notebooks",
    tags: "Tags",
    templates: "Templates",
    archived: "Archived",
    saved: "Saved searches",
    trash: "Trash",
  };
  return labels[id];
}

export type CalendarDay = {
  key: string;
  day: number;
  inMonth: boolean;
  isToday: boolean;
};

export function isoDayKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
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

export function reminderFallsOnDay(iso: string | null, dayKey: string): boolean {
  if (!iso) return false;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return false;
  return isoDayKey(date) === dayKey;
}

export function pinTabById<T extends { id: string; pinned?: boolean }>(
  tabs: T[],
  id: string
): T[] {
  return tabs.map((tab) => (tab.id === id ? { ...tab, pinned: !tab.pinned } : tab));
}

export function closeAllUnpinnedTabIds<T extends { id: string; pinned?: boolean }>(
  tabs: T[]
): string[] {
  return tabs.filter((tab) => !tab.pinned).map((tab) => tab.id);
}

export function renameSavedSearch(
  list: SavedSearch[],
  id: string,
  name: string
): SavedSearch[] {
  const cleaned = name.trim();
  if (!cleaned) return list;
  return list.map((item) => (item.id === id ? { ...item, name: cleaned } : item));
}

export const KEYBOARD_SHORTCUTS: [string, string][] = [
  ["New note", "Ctrl/⌘ N"],
  ["New note from template", "Ctrl/⌘ Shift N"],
  ["Find in note", "Ctrl/⌘ F"],
  ["Find and replace", "Ctrl/⌘ H"],
  ["Search all notes", "Ctrl/⌘ K or Ctrl/⌘ Shift F"],
  ["Hide / show note list", "Ctrl/⌘ Alt ←"],
  ["Expand / restore note", "Ctrl/⌘ Alt →"],
  ["Jump to note, notebook, or tag", "Ctrl/⌘ J"],
  ["Go to notebook", "Ctrl/⌘ Alt J"],
  ["Go to tag", "Ctrl/⌘ Alt T"],
  ["Command palette", "Ctrl/⌘ Shift P"],
  ["Keyboard shortcuts", "Ctrl/⌘ /"],
  ["Back", "Ctrl/⌘ ["],
  ["Forward", "Ctrl/⌘ ]"],
  ["Next note", "↓ or J"],
  ["Previous note", "↑ or K"],
  ["First / last note", "Home / End"],
  ["Page through notes", "PageDown / PageUp"],
  ["Rename note", "F2"],
  ["Print note", "Ctrl/⌘ P"],
  ["Note info", "Ctrl/⌘ Shift I"],
  ["Zoom in", "Ctrl/⌘ +"],
  ["Zoom out", "Ctrl/⌘ -"],
  ["Actual size", "Ctrl/⌘ 0"],
  ["Settings", "Ctrl/⌘ ,"],
  ["Copy note link", "⌃⌥⌘ C"],
  ["Send to OmniClone", "Note menu or Share"],
  ["New tab", "Ctrl/⌘ Shift T"],
  ["Open in new tab", "Ctrl/⌘ Alt O"],
  ["Close tab", "Ctrl/⌘ W"],
  ["Select all notes", "Ctrl/⌘ A"],
  ["Range select notes", "Shift+click"],
  ["Drag-select notes", "Click and drag"],
  ["Toggle note selection", "Ctrl/⌘+click"],
  ["Move selected notes to trash", "Delete"],
  ["Bold", "Ctrl/⌘ B"],
  ["Italic", "Ctrl/⌘ I"],
  ["Underline", "Ctrl/⌘ U"],
  ["Bulleted list", "Ctrl/⌘ Shift L"],
  ["Numbered list", "Ctrl/⌘ Shift O"],
  ["Checklist", "Ctrl/⌘ Shift C"],
  ["Increase indent", "Tab"],
  ["Decrease indent", "Shift+Tab"],
  ["Find next / previous", "F3 / Shift+F3"],
  ["Paste and match style", "Ctrl/⌘ Shift V"],
  ["Reopen closed tab", "File menu or tab right-click"],
];

export function clampImageWidth(width: number): number {
  if (!Number.isFinite(width)) return 320;
  return Math.min(1200, Math.max(80, Math.round(width)));
}

