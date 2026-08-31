// A single registry for the commands that used to be copied four times over:
// the menu bar (appMenus.ts), the command palette, the global keydown handler,
// and (for a few) context menus. Each command's `run` is lifted verbatim from
// whichever of those four copies was the most complete; see the architecture
// review report for the couple of places the old copies disagreed.
import type { Dispatch, SetStateAction } from "react";
import type {
  Note,
  NoteSummary,
  Notebook,
  Preferences,
  Stack,
  ViewFilter,
} from "./api.ts";
import type { RenameTarget } from "./appTypes.ts";
import { type EditorChrome, nextZoom } from "./ui/editorChrome.ts";
import { type ListView } from "./ui/noteList.ts";
import { type PaletteAction } from "./ui/search.ts";
import {
  type PaneLayout,
  isNoteExpanded,
  toggleNoteExpanded,
  toggleNoteListHidden,
} from "./ui/panes.ts";
import { type SidebarFlyoutKind } from "./ui/sidebar.ts";
import { type SnoozePreset } from "./ui/reminders.ts";
import type { EditorCommand } from "./editorHandle.ts";
import type { SettingsSection } from "./components/SettingsModal.tsx";

export type CommandContext = {
  filter: ViewFilter;
  selectedNoteIds: Set<string>;
  selectedNotes: NoteSummary[];
  shortcutIds: Set<string>;
  stacks: Stack[];
  notes: NoteSummary[];
  activeNote: Note | null;
  activeTabId: string;
  paneLayout: PaneLayout;
  editorChrome: EditorChrome;
  prefs: Preferences;
  showInfo: boolean;
  focusMode: boolean;
  isShortcut: boolean;
  allSelectedPinned: boolean;
  allSelectedArchived: boolean;
  allSelectedShortcuts: boolean;
  targetNoteIds: () => string[];
  createNote: () => void;
  createBlankNote: (notebookId?: string) => void;
  openNewStack: () => void;
  openRename: (target: RenameTarget) => void;
  openSettings: (section?: SettingsSection) => void;
  openNewTab: () => void;
  openInNewTab: (noteId: string) => void;
  closeTab: (id: string) => void;
  loadNote: (id: string) => void;
  setNewNotebookStackId: (id: string | null) => void;
  setNewName: (name: string) => void;
  setShowNewNotebook: (open: boolean) => void;
  setShowNewTag: (open: boolean) => void;
  setShowGallery: (open: boolean) => void;
  setNotebookPicker: (value: "move" | "copy" | null) => void;
  setShowInfo: Dispatch<SetStateAction<boolean>>;
  setShowJump: (open: boolean) => void;
  runEditorCommand: (command: EditorCommand) => void;
  openFind: () => void;
  openReplace: () => void;
  setFocusMode: Dispatch<SetStateAction<boolean>>;
  setFilter: (filter: ViewFilter) => void;
  setSelectedNoteIds: (ids: Set<string>) => void;
  setShowReminderMenu: (open: boolean) => void;
  setPrefs: Dispatch<SetStateAction<Preferences>>;
  setActiveNote: (note: Note | null) => void;
  persistPaneLayout: (layout: PaneLayout) => void;
  persistEditorChrome: (chrome: EditorChrome) => void;
  revealSidebarFlyout: (kind: SidebarFlyoutKind) => void;
  closeSidebarFlyout: () => void;
  restoreSelectedNotes: () => void;
  deleteSelectedNotes: () => void;
  shortcutSelectedNotes: (add: boolean) => void;
  pinSelectedNotes: (pinned: boolean) => void;
  duplicateSelectedNotes: () => void;
  mergeSelectedNotes: () => void;
  exportSelectedNotes: (format: "html" | "enex" | "markdown") => void;
  archiveSelectedNotes: (archived: boolean) => void;
  copyActiveNoteAs: (format: "rich" | "plain" | "markdown") => void;
  exportNotebook: (notebookId: string, name: string) => void;
  snoozeReminder: (kind: SnoozePreset) => void;
  searchInNotebook: (notebook: { id: string; name: string }) => void;
  updateNoteById: (id: string, patch: Partial<Note>) => Promise<unknown>;
  refreshMeta: () => Promise<void>;
  refreshNotes: () => Promise<void>;
  confirm: (
    message: string,
    options?: { confirmLabel?: string; danger?: boolean; always?: boolean }
  ) => Promise<boolean>;
  printActiveNote: () => void;
  copyActiveNoteLink: () => void;
  setListView: (view: ListView) => void;
  importNotes: () => void;
  setNotebookDefault: (notebook: Notebook) => void | Promise<void>;
  setNotebookStack: (notebookId: string, stackId: string | null) => void | Promise<void>;
  deleteNotebook: (notebook: Notebook) => void | Promise<void>;
  deleteStack: (stack: Stack) => void | Promise<void>;
  deleteTag: (tag: { id: string; name: string }) => void | Promise<void>;
  restoreTemplates: () => void | Promise<void>;
  toggleTheme: () => void;
  collapsedStacks: string[];
  toggleStackCollapsed: (id: string) => void;
  collapseAllStacks: () => void;
  expandAllStacks: () => void;
  canGoBack: boolean;
  canGoForward: boolean;
  goBack: () => void;
  goForward: () => void;
  emailActiveNote: (id?: string) => void;
  toggleReminderDone: (id?: string) => void;
  openCommandPalette: () => void;
  isReminderCompleted: (id: string) => boolean;
  openGlobalSearch: () => void;
};

export type KeyBinding = {
  key: string; // compared case-insensitively against event.key
  mod?: boolean; // ctrlKey || metaKey
  shift?: boolean;
  alt?: boolean;
};

export type Command = {
  id: string;
  label: string | ((ctx: CommandContext) => string);
  keys?: KeyBinding[];
  enabled?: (ctx: CommandContext) => boolean; // drives menu `disabled`
  run: (ctx: CommandContext) => void;
};

const ARROW_LABELS: Record<string, string> = {
  ArrowLeft: "←",
  ArrowRight: "→",
};

const VERBATIM_KEYS = new Set([",", "/", "[", "]", "+", "-", "0", "F11"]);

function keyLabel(key: string): string {
  if (ARROW_LABELS[key]) return ARROW_LABELS[key];
  if (VERBATIM_KEYS.has(key)) return key;
  return key.length === 1 ? key.toUpperCase() : key;
}

export function formatBinding(b: KeyBinding): string {
  const parts: string[] = [];
  if (b.mod) parts.push("Ctrl/⌘");
  if (b.shift) parts.push("⇧");
  if (b.alt) parts.push("Alt");
  parts.push(keyLabel(b.key));
  return parts.join(" ");
}

function keyMatches(bindingKey: string, eventKey: string): boolean {
  if (bindingKey === "[" && eventKey === "BracketLeft") return true;
  if (bindingKey === "]" && eventKey === "BracketRight") return true;
  return bindingKey.toLowerCase() === eventKey.toLowerCase();
}

function boolMatches(want: boolean | undefined, actual: boolean): boolean {
  return Boolean(want) === actual;
}

export const COMMANDS: Command[] = [
  {
    id: "note.new",
    label: "New Note",
    keys: [{ key: "n", mod: true }],
    run: (ctx) => ctx.createNote(),
  },
  {
    id: "note.newFromTemplate",
    label: "New Note from Template…",
    keys: [{ key: "n", mod: true, shift: true }],
    run: (ctx) => ctx.setShowGallery(true),
  },
  {
    id: "tab.new",
    label: "New Tab",
    keys: [{ key: "t", mod: true, shift: true }],
    run: (ctx) => ctx.openNewTab(),
  },
  {
    id: "note.openInNewTab",
    label: "Open in New Tab",
    keys: [{ key: "o", mod: true, alt: true }],
    enabled: (ctx) => !!ctx.activeNote,
    run: (ctx) => {
      if (ctx.activeNote) void ctx.openInNewTab(ctx.activeNote.id);
    },
  },
  {
    id: "tab.close",
    label: "Close Tab",
    keys: [{ key: "w", mod: true }],
    run: (ctx) => ctx.closeTab(ctx.activeTabId),
  },
  {
    id: "notebook.new",
    label: "New Notebook…",
    run: (ctx) => {
      ctx.setNewNotebookStackId(null);
      ctx.setNewName("");
      ctx.setShowNewNotebook(true);
    },
  },
  {
    id: "tag.new",
    label: "New Tag…",
    run: (ctx) => {
      ctx.setNewName("");
      ctx.setShowNewTag(true);
    },
  },
  {
    id: "note.print",
    label: "Print…",
    keys: [{ key: "p", mod: true }],
    enabled: (ctx) => !!ctx.activeNote,
    run: (ctx) => ctx.printActiveNote(),
  },
  {
    id: "note.email",
    label: "Email Note…",
    enabled: (ctx) => !!ctx.activeNote,
    run: (ctx) => void ctx.emailActiveNote(),
  },
  {
    id: "app.settings",
    label: "Settings…",
    keys: [{ key: ",", mod: true }],
    run: (ctx) => ctx.openSettings(),
  },
  {
    id: "app.keyboardShortcuts",
    label: "Keyboard Shortcuts",
    keys: [{ key: "/", mod: true }],
    run: (ctx) => ctx.openSettings("shortcuts"),
  },
  {
    id: "find.inNote",
    label: "Find…",
    keys: [{ key: "f", mod: true }],
    // No `enabled` gate on purpose: the keyboard binding must stay live with no
    // note open so it can fall back to global search, exactly as the old keydown
    // chain did. The menu item greys itself out via an explicit `disabled`
    // override at its call site in appMenus.ts.
    run: (ctx) => (ctx.activeNote ? ctx.openFind() : ctx.openGlobalSearch()),
  },
  {
    id: "find.replace",
    label: "Find and Replace…",
    keys: [{ key: "h", mod: true }],
    enabled: (ctx) => !!ctx.activeNote,
    run: (ctx) => {
      if (ctx.activeNote) ctx.openReplace();
    },
  },
  {
    id: "search.global",
    label: "Search Notes",
    keys: [
      { key: "k", mod: true },
      { key: "k", mod: true, shift: true },
      { key: "f", mod: true, shift: true },
    ],
    run: (ctx) => ctx.openGlobalSearch(),
  },
  {
    id: "view.allNotes",
    label: "All Notes",
    run: (ctx) => {
      ctx.closeSidebarFlyout();
      ctx.setFilter({ type: "all" });
    },
  },
  {
    id: "view.shortcuts",
    label: "Shortcuts",
    run: (ctx) => {
      ctx.revealSidebarFlyout("shortcuts");
      ctx.setFilter({ type: "shortcuts" });
    },
  },
  {
    id: "view.reminders",
    label: "Reminders",
    run: (ctx) => {
      ctx.closeSidebarFlyout();
      ctx.setFilter({ type: "reminders" });
    },
  },
  {
    id: "view.files",
    label: "Files",
    run: (ctx) => {
      ctx.closeSidebarFlyout();
      ctx.setFilter({ type: "files" });
    },
  },
  {
    id: "nav.back",
    label: "Back",
    keys: [{ key: "[", mod: true }],
    enabled: (ctx) => ctx.canGoBack,
    run: (ctx) => ctx.goBack(),
  },
  {
    id: "nav.forward",
    label: "Forward",
    keys: [{ key: "]", mod: true }],
    enabled: (ctx) => ctx.canGoForward,
    run: (ctx) => ctx.goForward(),
  },
  {
    id: "view.toggleNoteList",
    label: (ctx) => (ctx.paneLayout.listCollapsed ? "Show Note List" : "Hide Note List"),
    keys: [{ key: "ArrowLeft", mod: true, alt: true }],
    run: (ctx) => ctx.persistPaneLayout(toggleNoteListHidden(ctx.paneLayout)),
  },
  {
    id: "view.expandNote",
    label: (ctx) => (isNoteExpanded(ctx.paneLayout) ? "Restore Panes" : "Expand Note"),
    keys: [{ key: "ArrowRight", mod: true, alt: true }],
    run: (ctx) => ctx.persistPaneLayout(toggleNoteExpanded(ctx.paneLayout)),
  },
  {
    id: "view.noteInfo",
    label: (ctx) => (ctx.showInfo ? "Hide Note Info" : "Show Note Info"),
    keys: [{ key: "i", mod: true, shift: true }],
    enabled: (ctx) => !!ctx.activeNote,
    run: (ctx) => ctx.setShowInfo((open) => !open),
  },
  {
    id: "view.focusMode",
    label: (ctx) => (ctx.focusMode ? "Exit Focus Mode" : "Enter Focus Mode"),
    keys: [{ key: "F11" }],
    run: (ctx) => ctx.setFocusMode((open) => !open),
  },
  {
    id: "view.outline",
    label: (ctx) => (ctx.editorChrome.outlineOpen ? "Hide Note Outline" : "Show Note Outline"),
    run: (ctx) =>
      ctx.persistEditorChrome({
        ...ctx.editorChrome,
        outlineOpen: !ctx.editorChrome.outlineOpen,
      }),
  },
  {
    id: "view.theme",
    label: (ctx) => (ctx.prefs.theme === "dark" ? "Use Light Theme" : "Use Dark Theme"),
    run: (ctx) => ctx.toggleTheme(),
  },
  {
    id: "view.zoomIn",
    label: "Zoom In",
    keys: [
      { key: "+", mod: true },
      { key: "=", mod: true },
      { key: "+", mod: true, shift: true },
    ],
    enabled: (ctx) => !!ctx.activeNote,
    run: (ctx) =>
      ctx.persistEditorChrome({
        ...ctx.editorChrome,
        zoom: nextZoom(ctx.editorChrome.zoom, 1),
      }),
  },
  {
    id: "view.zoomOut",
    label: "Zoom Out",
    keys: [{ key: "-", mod: true }],
    enabled: (ctx) => !!ctx.activeNote,
    run: (ctx) =>
      ctx.persistEditorChrome({
        ...ctx.editorChrome,
        zoom: nextZoom(ctx.editorChrome.zoom, -1),
      }),
  },
  {
    id: "view.zoomReset",
    label: "Actual Size",
    keys: [{ key: "0", mod: true }],
    enabled: (ctx) => !!ctx.activeNote && ctx.editorChrome.zoom !== 100,
    run: (ctx) =>
      ctx.persistEditorChrome({
        ...ctx.editorChrome,
        zoom: nextZoom(ctx.editorChrome.zoom, 0),
      }),
  },
  {
    id: "jump.open",
    label: "Jump to…",
    keys: [{ key: "j", mod: true }],
    run: (ctx) => ctx.setShowJump(true),
  },
  {
    id: "palette.open",
    label: "Command Palette…",
    keys: [{ key: "p", mod: true, shift: true }],
    run: (ctx) => ctx.openCommandPalette(),
  },
  {
    id: "format.bulletList",
    label: "Bulleted List",
    keys: [{ key: "l", mod: true, shift: true }],
    enabled: (ctx) => !!ctx.activeNote,
    run: (ctx) => ctx.runEditorCommand({ type: "bulletList" }),
  },
  {
    id: "format.orderedList",
    label: "Numbered List",
    keys: [{ key: "o", mod: true, shift: true }],
    enabled: (ctx) => !!ctx.activeNote,
    run: (ctx) => ctx.runEditorCommand({ type: "orderedList" }),
  },
  {
    id: "format.taskList",
    label: "Checklist",
    keys: [{ key: "c", mod: true, shift: true }],
    enabled: (ctx) => !!ctx.activeNote,
    run: (ctx) => ctx.runEditorCommand({ type: "taskList" }),
  },
];

export function matchCommand(
  event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "shiftKey" | "altKey">,
  ctx: CommandContext
): Command | null {
  const mod = event.ctrlKey || event.metaKey;
  for (const cmd of COMMANDS) {
    if (!cmd.keys) continue;
    const hit = cmd.keys.some(
      (b) =>
        keyMatches(b.key, event.key) &&
        boolMatches(b.mod, mod) &&
        boolMatches(b.shift, event.shiftKey) &&
        boolMatches(b.alt, event.altKey)
    );
    if (!hit) continue;
    if (cmd.enabled && !cmd.enabled(ctx)) continue;
    return cmd;
  }
  return null;
}

export function commandById(id: string): Command | undefined {
  return COMMANDS.find((cmd) => cmd.id === id);
}

export function commandLabel(cmd: Command, ctx: CommandContext): string {
  return typeof cmd.label === "function" ? cmd.label(ctx) : cmd.label;
}

export function commandShortcut(cmd: Command): string | undefined {
  return cmd.keys && cmd.keys.length ? formatBinding(cmd.keys[0]) : undefined;
}

export function runCommandById(id: string, ctx: CommandContext): void {
  const cmd = commandById(id);
  if (cmd) cmd.run(ctx);
}

// Palette wording and order predate the registry and differ from the menu
// bar's wording, so they're kept as an explicit override rather than derived.
const PALETTE_LABELS: Record<string, string> = {
  "note.new": "New note",
  "search.global": "Search notes",
  "jump.open": "Jump to…",
  "app.settings": "Settings",
  "note.newFromTemplate": "Browse templates",
  "note.print": "Print note",
  "note.email": "Email note…",
  "view.theme": "Toggle theme",
  "view.focusMode": "Focus mode",
  "nav.back": "Go back",
  "nav.forward": "Go forward",
  "notebook.new": "New notebook…",
  "tag.new": "New tag…",
  "view.reminders": "Show reminders",
  "view.shortcuts": "Show shortcuts",
  "view.files": "Show files",
  "view.allNotes": "All notes",
  "view.noteInfo": "Note info",
  "view.outline": "Toggle note outline",
};

export const PALETTE_ORDER: string[] = [
  "note.new",
  "search.global",
  "jump.open",
  "app.settings",
  "note.newFromTemplate",
  "note.print",
  "note.email",
  "view.theme",
  "view.focusMode",
  "nav.back",
  "nav.forward",
  "notebook.new",
  "tag.new",
  "view.reminders",
  "view.shortcuts",
  "view.files",
  "view.allNotes",
  "view.noteInfo",
  "view.outline",
];

export function paletteActions(ctx: CommandContext): PaletteAction[] {
  return PALETTE_ORDER.map((id) => {
    const cmd = commandById(id);
    if (!cmd) throw new Error(`paletteActions: unknown command id "${id}"`);
    return {
      id,
      label: PALETTE_LABELS[id] ?? commandLabel(cmd, ctx),
      hint: commandShortcut(cmd),
    };
  });
}
