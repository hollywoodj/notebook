export const SIDEBAR_MIN = 180;
export const SIDEBAR_MAX = 420;
export const LIST_MIN = 220;
export const LIST_MAX = 560;
export const DEFAULT_SIDEBAR_WIDTH = 248;
export const DEFAULT_LIST_WIDTH = 320;
export const SIDEBAR_RAIL_WIDTH = 56;
/** Dragging the sidebar edge inside this width snaps it back to the icon rail. */
export const SIDEBAR_RAIL_SNAP = 140;
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
  sidebarRail: boolean;
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
    sidebarRail: true,
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
      sidebarRail: parsed.sidebarRail !== false,
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

/** The sidebar shows the icon rail only when it is in rail mode and not fully hidden. */
export function isSidebarRail(layout: PaneLayout): boolean {
  return layout.sidebarRail && !layout.sidebarCollapsed;
}

export function toggleSidebarRail(layout: PaneLayout): PaneLayout {
  return { ...layout, sidebarCollapsed: false, sidebarRail: !layout.sidebarRail };
}

/**
 * Resizes the sidebar to the dragged edge position. Tracking the pointer rather
 * than accumulating deltas is what lets a drag cross between the rail and a
 * pinned sidebar, since the pinned width clamps at `SIDEBAR_MIN`.
 */
export function resizeSidebarTo(layout: PaneLayout, edge: number): PaneLayout {
  if (edge < SIDEBAR_RAIL_SNAP) {
    return { ...layout, sidebarCollapsed: false, sidebarRail: true };
  }
  return {
    ...layout,
    sidebarCollapsed: false,
    sidebarRail: false,
    sidebarWidth: clampPaneWidth(edge, SIDEBAR_MIN, SIDEBAR_MAX),
  };
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
  | { type: "bulletList" | "orderedList" | "taskList" | "blockquote" | "codeBlock" | "inlineCode" | "inlineCheckbox" }
  | { type: "align"; align: "left" | "center" | "right" | "justify" }
  | { type: "indent" | "outdent" }
  | { type: "link"; href?: string; text?: string }
  | { type: "openLinkDialog" }
  | { type: "fontFamily"; family?: string }
  | { type: "fontSize"; size?: string }
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
  outlineOpen: boolean;
}

export function defaultEditorChrome(): EditorChrome {
  return {
    toolbarHidden: false,
    attachmentsExpanded: false,
    zoom: DEFAULT_ZOOM,
    outlineOpen: false,
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

export type NoteListFacet = "reminder" | "attachment";

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
