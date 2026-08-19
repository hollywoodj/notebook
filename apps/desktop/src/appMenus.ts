import type { Dispatch, SetStateAction } from "react";
import type {
  Note,
  NoteSummary,
  Notebook,
  Preferences,
  Stack,
  ViewFilter,
} from "./api.ts";
import type { ContextMenuEntry } from "./components/ContextMenu.tsx";
import type { MenuBarGroup } from "./components/MenuBar.tsx";
import type { SettingsSection } from "./components/SettingsModal.tsx";
import {
  type ContextTarget,
  type RenameTarget,
  isTextInputFocused,
} from "./appTypes.ts";
import {
  type EditorChrome,
  type EditorCommand,
  HIGHLIGHT_COLORS,
  type ListView,
  type PaneLayout,
  type SidebarFlyout,
  type SidebarFlyoutKind,
  type SnoozePreset,
  TEXT_COLORS,
  dispatchEditorCommand,
  isNoteExpanded,
  nextZoom,
  noteAppLink,
  toggleNoteExpanded,
  toggleNoteListHidden,
  toggleSidebarRail,
} from "./uiChrome.ts";

export type AppMenuContext = {
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
  setFindTick: Dispatch<SetStateAction<number>>;
  setReplaceTick: Dispatch<SetStateAction<number>>;
  setFocusMode: Dispatch<SetStateAction<boolean>>;
  setFilter: (filter: ViewFilter) => void;
  setSidebarFlyout: (flyout: SidebarFlyout) => void;
  setSelectedNoteIds: (ids: Set<string>) => void;
  setShowReminderMenu: (open: boolean) => void;
  setPrefs: Dispatch<SetStateAction<Preferences>>;
  setActiveNote: (note: Note | null) => void;
  persistPaneLayout: (layout: PaneLayout) => void;
  persistEditorChrome: (chrome: EditorChrome) => void;
  revealSidebarFlyout: (kind: SidebarFlyoutKind) => void;
  restoreSelectedNotes: () => void;
  deleteSelectedNotes: () => void;
  shortcutSelectedNotes: (add: boolean) => void;
  pinSelectedNotes: (pinned: boolean) => void;
  duplicateSelectedNotes: () => void;
  mergeSelectedNotes: () => void;
  exportSelectedNotes: (format: "html" | "enex" | "markdown" | "pdf") => void;
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
  copyNoteTitle: (title?: string) => void;
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
  tags: { id: string; name: string }[];
  addTagToSelected: (tagId: string) => void;
  openJump: (mode?: "all" | "notebook") => void;
  reopenClosedTab: () => void;
  canReopenClosedTab: boolean;
};

export function runEditorCommand(command: EditorCommand) {
  dispatchEditorCommand(command);
}

export function buildContextMenu(
  target: ContextTarget,
  ctx: AppMenuContext
): ContextMenuEntry[] {
  if (target.kind === "sidebar") {
    return [
      {
        label: "New note",
        shortcut: "Ctrl/⌘ N",
        onSelect: () => void ctx.createNote(),
      },
      {
        label: "New notebook…",
        onSelect: () => {
          ctx.setNewNotebookStackId(null);
          ctx.setNewName("");
          ctx.setShowNewNotebook(true);
        },
      },
      {
        label: "New stack…",
        onSelect: ctx.openNewStack,
      },
      {
        label: "New tag…",
        onSelect: () => {
          ctx.setNewName("");
          ctx.setShowNewTag(true);
        },
      },
      { type: "separator" },
      {
        label: "Settings…",
        shortcut: "Ctrl/⌘ ,",
        onSelect: () => ctx.openSettings(),
      },
    ];
  }

  if (target.kind === "note") {
    const targets =
      ctx.selectedNoteIds.size > 1 && ctx.selectedNoteIds.has(target.note.id)
        ? ctx.selectedNotes
        : [target.note];
    const ids = targets.map((note) => note.id);
    const count = targets.length;
    const inTrash = ctx.filter.type === "trash";
    const allShortcuts = targets.every((note) => ctx.shortcutIds.has(note.id));
    const allPinned = targets.every((note) => note.is_pinned);
    const allArchived = targets.every((note) => note.is_archived);
    const allTemplates = targets.every((note) => note.is_template);

    if (inTrash) {
      return [
        {
          label: count > 1 ? `Restore ${count} notes` : "Restore note",
          onSelect: () => void ctx.restoreSelectedNotes(),
        },
        { type: "separator" },
        {
          label: count > 1 ? `Delete ${count} notes permanently` : "Delete permanently",
          danger: true,
          shortcut: "Delete",
          onSelect: () => void ctx.deleteSelectedNotes(),
        },
      ];
    }

    return [
      ...(count === 1
        ? [
            { label: "Open note", onSelect: () => void ctx.loadNote(targets[0].id) },
            {
              label: "Open in New Tab",
              onSelect: () => void ctx.openInNewTab(targets[0].id),
            },
            {
              label: "Rename note…",
              onSelect: () =>
                ctx.openRename({
                  kind: "note",
                  id: targets[0].id,
                  name: targets[0].title || "Untitled",
                }),
            },
            {
              label: "Copy title",
              onSelect: () => ctx.copyNoteTitle(targets[0].title),
            },
          ]
        : []),
      {
        label: allShortcuts
          ? count > 1
            ? `Remove ${count} from shortcuts`
            : "Remove from shortcuts"
          : count > 1
            ? `Add ${count} to shortcuts`
            : "Add to shortcuts",
        onSelect: () => void ctx.shortcutSelectedNotes(!allShortcuts),
      },
      {
        label: allPinned
          ? count > 1
            ? `Unpin ${count} notes`
            : "Unpin from top"
          : count > 1
            ? `Pin ${count} notes`
            : "Pin to top",
        onSelect: () => void ctx.pinSelectedNotes(!allPinned),
      },
      {
        label: "Move to notebook…",
        onSelect: () => ctx.setNotebookPicker("move"),
      },
      {
        label: count > 1 ? `Duplicate ${count} notes` : "Duplicate note",
        onSelect: () => void ctx.duplicateSelectedNotes(),
      },
      {
        label: "Copy to notebook…",
        onSelect: () => ctx.setNotebookPicker("copy"),
      },
      ...(count === 1
        ? [
            {
              label: "Add tag",
              children: ctx.tags.length
                ? ctx.tags
                    .filter((tag) => !targets[0].tag_ids.includes(tag.id))
                    .slice(0, 12)
                    .map((tag) => ({
                      label: tag.name,
                      onSelect: () => ctx.addTagToSelected(tag.id),
                    }))
                : [{ label: "No tags yet", disabled: true }],
            },
          ]
        : []),
      ...(count > 1
        ? [
            {
              label: `Merge ${count} notes`,
              onSelect: () => void ctx.mergeSelectedNotes(),
            },
          ]
        : []),
      {
        label: count > 1 ? "Export notes as HTML" : "Export as HTML",
        onSelect: () => void ctx.exportSelectedNotes("html"),
      },
      {
        label: count > 1 ? "Export notes as Evernote XML" : "Export as Evernote XML",
        onSelect: () => void ctx.exportSelectedNotes("enex"),
      },
      {
        label: count > 1 ? "Export notes as Markdown" : "Export as Markdown",
        onSelect: () => void ctx.exportSelectedNotes("markdown"),
      },
      {
        label: count > 1 ? "Export notes as PDF" : "Export as PDF",
        onSelect: () => void ctx.exportSelectedNotes("pdf"),
      },
      ...(count === 1
        ? [
            {
              label: "Copy as",
              children: [
                {
                  label: "Rich Text",
                  onSelect: () => void ctx.copyActiveNoteAs("rich"),
                },
                {
                  label: "Plain Text",
                  onSelect: () => void ctx.copyActiveNoteAs("plain"),
                },
                {
                  label: "Markdown",
                  onSelect: () => void ctx.copyActiveNoteAs("markdown"),
                },
              ],
            },
          ]
        : []),
      ...(targets.some((note) => note.reminder_at)
        ? [
            {
              label: "Snooze reminder",
              children: [
                {
                  label: "Later today",
                  onSelect: () => void ctx.snoozeReminder("laterToday"),
                },
                {
                  label: "Tomorrow morning",
                  onSelect: () => void ctx.snoozeReminder("tomorrowMorning"),
                },
              ],
            },
          ]
        : []),
      ...(count === 1 && targets[0].reminder_at
        ? [
            {
              label: ctx.isReminderCompleted(targets[0].id)
                ? "Restore reminder"
                : "Mark reminder done",
              onSelect: () => ctx.toggleReminderDone(targets[0].id),
            },
          ]
        : []),
      ...(count === 1
        ? [
            {
              label: "Copy note link",
              onSelect: () =>
                void navigator.clipboard.writeText(noteAppLink(targets[0].id)),
            },
            {
              label: "Email note…",
              onSelect: () => ctx.emailActiveNote(targets[0].id),
            },
            {
              label: "Note info",
              onSelect: () => {
                void ctx.loadNote(targets[0].id);
                ctx.setShowInfo(true);
              },
            },
          ]
        : []),
      { type: "separator" },
      ...(count === 1
        ? [
            {
              label: allTemplates ? "Convert to note" : "Save as template",
              onSelect: async () => {
                await ctx.updateNoteById(ids[0], {
                  is_template: !allTemplates,
                  template_category: allTemplates ? null : "My templates",
                });
                await ctx.refreshMeta();
              },
            },
          ]
        : []),
      {
        label: allArchived
          ? count > 1
            ? `Unarchive ${count} notes`
            : "Unarchive note"
          : count > 1
            ? `Archive ${count} notes`
            : "Archive note",
        onSelect: () => void ctx.archiveSelectedNotes(!allArchived),
      },
      { type: "separator" },
      {
        label: count > 1 ? `Move ${count} notes to trash` : "Move to trash",
        danger: true,
        shortcut: "Delete",
        onSelect: () => void ctx.deleteSelectedNotes(),
      },
    ];
  }

  if (target.kind === "notebook") {
    const { notebook } = target;
    return [
      {
        label: "New note in this notebook",
        onSelect: () => void ctx.createBlankNote(notebook.id),
      },
      {
        label: "Rename notebook…",
        onSelect: () =>
          ctx.openRename({
            kind: "notebook",
            id: notebook.id,
            name: notebook.name,
          }),
      },
      {
        label: "Set as default notebook",
        checked: notebook.is_default,
        disabled: notebook.is_default,
        onSelect: () => void ctx.setNotebookDefault(notebook),
      },
      {
        label: "Move to stack",
        children: [
          {
            label: "No stack",
            checked: notebook.stack_id === null,
            disabled: notebook.stack_id === null,
            onSelect: () => void ctx.setNotebookStack(notebook.id, null),
          },
          { type: "separator" },
          ...ctx.stacks.map((stack) => ({
            label: stack.name,
            checked: notebook.stack_id === stack.id,
            disabled: notebook.stack_id === stack.id,
            onSelect: () => void ctx.setNotebookStack(notebook.id, stack.id),
          })),
        ],
      },
      {
        label: "Search in this notebook",
        onSelect: () => ctx.searchInNotebook({ id: notebook.id, name: notebook.name }),
      },
      {
        label: "Export notebook as Evernote XML",
        onSelect: () => void ctx.exportNotebook(notebook.id, notebook.name),
      },
      { type: "separator" },
      {
        label: "Delete notebook",
        danger: true,
        disabled: notebook.is_default,
          onSelect: () => void ctx.deleteNotebook(notebook),
      },
    ];
  }

  if (target.kind === "stack") {
    const { stack } = target;
    return [
      {
        label: "New notebook in this stack…",
        onSelect: () => {
          ctx.setNewNotebookStackId(stack.id);
          ctx.setNewName("");
          ctx.setShowNewNotebook(true);
        },
      },
      {
        label: "Rename stack…",
        onSelect: () =>
          ctx.openRename({ kind: "stack", id: stack.id, name: stack.name }),
      },
      {
        label: ctx.collapsedStacks.includes(stack.id) ? "Expand stack" : "Collapse stack",
        onSelect: () => ctx.toggleStackCollapsed(stack.id),
      },
      {
        label: "Collapse all stacks",
        disabled: ctx.stacks.length === 0,
        onSelect: ctx.collapseAllStacks,
      },
      {
        label: "Expand all stacks",
        disabled: ctx.collapsedStacks.length === 0,
        onSelect: ctx.expandAllStacks,
      },
      { type: "separator" },
      {
        label: "Delete stack",
        danger: true,
        onSelect: () => void ctx.deleteStack(stack),
      },
    ];
  }

  const { tag } = target;
  return [
    {
      label: "Show notes with this tag",
      onSelect: () => ctx.setFilter({ type: "tag", id: tag.id, name: tag.name }),
    },
    {
      label: "Rename tag…",
      onSelect: () => ctx.openRename({ kind: "tag", id: tag.id, name: tag.name }),
    },
    { type: "separator" },
    {
      label: "Delete tag",
      danger: true,
      onSelect: () => void ctx.deleteTag(tag),
    },
  ];
}

export function buildMenuBar(ctx: AppMenuContext): MenuBarGroup[] {
  return [
    {
      label: "File",
      items: [
        { label: "New Note", shortcut: "Ctrl/⌘ N", onSelect: () => void ctx.createNote() },
        {
          label: "New Note from Template…",
          shortcut: "Ctrl/⌘ ⇧ N",
          onSelect: () => ctx.setShowGallery(true),
        },
        {
          label: "New Tab",
          shortcut: "Ctrl/⌘ ⇧ T",
          onSelect: () => ctx.openNewTab(),
        },
        {
          label: "Open in New Tab",
          shortcut: "Ctrl/⌘ Alt O",
          disabled: !ctx.activeNote,
          onSelect: () => {
            if (ctx.activeNote) void ctx.openInNewTab(ctx.activeNote.id);
          },
        },
        {
          label: "Close Tab",
          shortcut: "Ctrl/⌘ W",
          onSelect: () => ctx.closeTab(ctx.activeTabId),
        },
        { type: "separator" },
        {
          label: "Reopen Closed Tab",
          disabled: !ctx.canReopenClosedTab,
          onSelect: ctx.reopenClosedTab,
        },
        {
          label: "New Notebook…",
          onSelect: () => {
            ctx.setNewNotebookStackId(null);
            ctx.setNewName("");
            ctx.setShowNewNotebook(true);
          },
        },
        {
          label: "New Stack…",
          onSelect: ctx.openNewStack,
        },
        { type: "separator" },
        {
          label: "Import Notes…",
          onSelect: ctx.importNotes,
        },
        {
          label: "Export as HTML…",
          disabled: ctx.targetNoteIds().length === 0,
          onSelect: () => void ctx.exportSelectedNotes("html"),
        },
        {
          label: "Export as Evernote XML…",
          disabled: ctx.targetNoteIds().length === 0,
          onSelect: () => void ctx.exportSelectedNotes("enex"),
        },
        {
          label: "Export as Markdown…",
          disabled: ctx.targetNoteIds().length === 0,
          onSelect: () => void ctx.exportSelectedNotes("markdown"),
        },
        {
          label: "Export as PDF…",
          disabled: ctx.targetNoteIds().length === 0,
          onSelect: () => void ctx.exportSelectedNotes("pdf"),
        },
        {
          label: "Copy as",
          disabled: !ctx.activeNote,
          children: [
            {
              label: "Rich Text",
              disabled: !ctx.activeNote,
              onSelect: () => void ctx.copyActiveNoteAs("rich"),
            },
            {
              label: "Plain Text",
              disabled: !ctx.activeNote,
              onSelect: () => void ctx.copyActiveNoteAs("plain"),
            },
            {
              label: "Markdown",
              disabled: !ctx.activeNote,
              onSelect: () => void ctx.copyActiveNoteAs("markdown"),
            },
          ],
        },
        {
          label: "Print…",
          shortcut: "Ctrl/⌘ P",
          disabled: !ctx.activeNote,
          onSelect: ctx.printActiveNote,
        },
        {
          label: "Email Note…",
          disabled: !ctx.activeNote,
          onSelect: ctx.emailActiveNote,
        },
        {
          label: "Copy Note Link",
          disabled: !ctx.activeNote,
          onSelect: () => void ctx.copyActiveNoteLink(),
        },
        { type: "separator" },
        {
          label: "Settings…",
          shortcut: "Ctrl/⌘ ,",
          onSelect: () => ctx.openSettings(),
        },
      ],
    },
    {
      label: "Edit",
      items: [
        { label: "Undo", shortcut: "Ctrl/⌘ Z", onSelect: () => runEditorCommand({ type: "undo" }) },
        {
          label: "Redo",
          shortcut: "Ctrl/⌘ ⇧ Z",
          onSelect: () => runEditorCommand({ type: "redo" }),
        },
        { type: "separator" },
        { label: "Cut", shortcut: "Ctrl/⌘ X", onSelect: () => runEditorCommand({ type: "cut" }) },
        { label: "Copy", shortcut: "Ctrl/⌘ C", onSelect: () => runEditorCommand({ type: "copy" }) },
        { label: "Paste", shortcut: "Ctrl/⌘ V", onSelect: () => runEditorCommand({ type: "paste" }) },
        {
          label: "Paste and Match Style",
          shortcut: "Ctrl/⌘ ⇧ V",
          disabled: !ctx.activeNote,
          onSelect: () => runEditorCommand({ type: "pastePlain" }),
        },
        { type: "separator" },
        {
          label: "Select All",
          shortcut: "Ctrl/⌘ A",
          onSelect: () => {
            if (isTextInputFocused()) {
              runEditorCommand({ type: "selectAll" });
              return;
            }
            ctx.setSelectedNoteIds(new Set(ctx.notes.map((n) => n.id)));
          },
        },
        {
          label: "Find…",
          shortcut: "Ctrl/⌘ F",
          disabled: !ctx.activeNote,
          onSelect: () => ctx.setFindTick((tick) => tick + 1),
        },
        {
          label: "Find and Replace…",
          shortcut: "Ctrl/⌘ H",
          disabled: !ctx.activeNote,
          onSelect: () => ctx.setReplaceTick((tick) => tick + 1),
        },
        {
          label: "Find Next",
          shortcut: "F3",
          disabled: !ctx.activeNote,
          onSelect: () => runEditorCommand({ type: "findNext" }),
        },
        {
          label: "Find Previous",
          shortcut: "⇧ F3",
          disabled: !ctx.activeNote,
          onSelect: () => runEditorCommand({ type: "findPrev" }),
        },
      ],
    },
    {
      label: "View",
      items: [
        { label: "All Notes", onSelect: () => { ctx.setSidebarFlyout(null); ctx.setFilter({ type: "all" }); } },
        { label: "Shortcuts", onSelect: () => { ctx.revealSidebarFlyout("shortcuts"); ctx.setFilter({ type: "shortcuts" }); } },
        { label: "Notebooks", onSelect: () => ctx.revealSidebarFlyout("notebooks") },
        { label: "Tags", onSelect: () => ctx.revealSidebarFlyout("tags") },
        { label: "Reminders", onSelect: () => { ctx.setSidebarFlyout(null); ctx.setFilter({ type: "reminders" }); } },
        { label: "Templates", onSelect: () => { ctx.setSidebarFlyout(null); ctx.setFilter({ type: "templates" }); } },
        { label: "Archived", onSelect: () => { ctx.setSidebarFlyout(null); ctx.setFilter({ type: "archived" }); } },
        { type: "separator" },
        {
          label: "Back",
          shortcut: "Ctrl/⌘ [",
          disabled: !ctx.canGoBack,
          onSelect: ctx.goBack,
        },
        {
          label: "Forward",
          shortcut: "Ctrl/⌘ ]",
          disabled: !ctx.canGoForward,
          onSelect: ctx.goForward,
        },
        { type: "separator" },
        {
          label: ctx.paneLayout.sidebarCollapsed ? "Show Sidebar" : "Hide Sidebar",
          onSelect: () =>
            ctx.persistPaneLayout({
              ...ctx.paneLayout,
              sidebarCollapsed: !ctx.paneLayout.sidebarCollapsed,
            }),
        },
        {
          label: ctx.paneLayout.sidebarRail ? "Pin Sidebar Open" : "Collapse Sidebar to Icons",
          shortcut: "Ctrl/⌘ Alt S",
          onSelect: () => ctx.persistPaneLayout(toggleSidebarRail(ctx.paneLayout)),
        },
        {
          label: ctx.paneLayout.listCollapsed ? "Show Note List" : "Hide Note List",
          shortcut: "Ctrl/⌘ Alt ←",
          onSelect: () => ctx.persistPaneLayout(toggleNoteListHidden(ctx.paneLayout)),
        },
        {
          label: isNoteExpanded(ctx.paneLayout) ? "Restore Panes" : "Expand Note",
          shortcut: "Ctrl/⌘ Alt →",
          onSelect: () => ctx.persistPaneLayout(toggleNoteExpanded(ctx.paneLayout)),
        },
        {
          label: ctx.editorChrome.toolbarHidden
            ? "Show Formatting Toolbar"
            : "Hide Formatting Toolbar",
          disabled: !ctx.activeNote,
          onSelect: () =>
            ctx.persistEditorChrome({
              ...ctx.editorChrome,
              toolbarHidden: !ctx.editorChrome.toolbarHidden,
            }),
        },
        {
          label: ctx.editorChrome.outlineOpen ? "Hide Note Outline" : "Show Note Outline",
          disabled: !ctx.activeNote,
          onSelect: () =>
            ctx.persistEditorChrome({
              ...ctx.editorChrome,
              outlineOpen: !ctx.editorChrome.outlineOpen,
            }),
        },
        {
          label: ctx.editorChrome.attachmentsExpanded
            ? "Hide Attachments"
            : "Show Attachments",
          disabled: !ctx.activeNote,
          onSelect: () =>
            ctx.persistEditorChrome({
              ...ctx.editorChrome,
              attachmentsExpanded: !ctx.editorChrome.attachmentsExpanded,
            }),
        },
        {
          label: ctx.showInfo ? "Hide Note Info" : "Show Note Info",
          disabled: !ctx.activeNote,
          shortcut: "Ctrl/⌘ ⇧ I",
          onSelect: () => ctx.setShowInfo((open) => !open),
        },
        {
          label: ctx.focusMode ? "Exit Focus Mode" : "Enter Focus Mode",
          shortcut: "F11",
          onSelect: () => ctx.setFocusMode((open) => !open),
        },
        { type: "separator" },
        {
          label: "Jump to…",
          shortcut: "Ctrl/⌘ J",
          onSelect: () => ctx.openJump("all"),
        },
        {
          label: "Go to Notebook…",
          shortcut: "Ctrl/⌘ Alt J",
          onSelect: () => ctx.openJump("notebook"),
        },
        {
          label: "Command Palette…",
          shortcut: "Ctrl/⌘ ⇧ P",
          onSelect: ctx.openCommandPalette,
        },
        {
          label: "Snippets View",
          onSelect: () => ctx.setListView("snippets"),
        },
        {
          label: "Titles View",
          onSelect: () => ctx.setListView("titles"),
        },
        {
          label: "Cards View",
          onSelect: () => ctx.setListView("cards"),
        },
        { type: "separator" },
        {
          label: "Zoom In",
          shortcut: "Ctrl/⌘ +",
          disabled: !ctx.activeNote,
          onSelect: () =>
            ctx.persistEditorChrome({
              ...ctx.editorChrome,
              zoom: nextZoom(ctx.editorChrome.zoom, 1),
            }),
        },
        {
          label: "Zoom Out",
          shortcut: "Ctrl/⌘ -",
          disabled: !ctx.activeNote,
          onSelect: () =>
            ctx.persistEditorChrome({
              ...ctx.editorChrome,
              zoom: nextZoom(ctx.editorChrome.zoom, -1),
            }),
        },
        {
          label: "Actual Size",
          shortcut: "Ctrl/⌘ 0",
          disabled: !ctx.activeNote || ctx.editorChrome.zoom === 100,
          onSelect: () =>
            ctx.persistEditorChrome({
              ...ctx.editorChrome,
              zoom: nextZoom(ctx.editorChrome.zoom, 0),
            }),
        },
        { type: "separator" },
        {
          label: ctx.prefs.theme === "dark" ? "Use Light Theme" : "Use Dark Theme",
          onSelect: () => ctx.toggleTheme(),
        },
        { type: "separator" },
        {
          label: "Collapse All Stacks",
          disabled: ctx.stacks.length === 0,
          onSelect: ctx.collapseAllStacks,
        },
        {
          label: "Expand All Stacks",
          disabled: ctx.collapsedStacks.length === 0,
          onSelect: ctx.expandAllStacks,
        },
      ],
    },
    {
      label: "Note",
      items: [
        {
          label:
            ctx.selectedNoteIds.size > 1
              ? ctx.allSelectedPinned
                ? `Unpin ${ctx.selectedNoteIds.size} Notes`
                : `Pin ${ctx.selectedNoteIds.size} Notes`
              : ctx.activeNote?.is_pinned
                ? "Unpin Note"
                : "Pin Note",
          disabled: ctx.targetNoteIds().length === 0,
          onSelect: () => {
            void ctx.pinSelectedNotes(
              ctx.selectedNoteIds.size > 1 ? !ctx.allSelectedPinned : !ctx.activeNote?.is_pinned
            );
          },
        },
        {
          label:
            ctx.selectedNoteIds.size > 1
              ? ctx.allSelectedShortcuts
                ? `Remove ${ctx.selectedNoteIds.size} from Shortcuts`
                : `Add ${ctx.selectedNoteIds.size} to Shortcuts`
              : ctx.isShortcut
                ? "Remove from Shortcuts"
                : "Add to Shortcuts",
          disabled: ctx.targetNoteIds().length === 0,
          onSelect: () =>
            void ctx.shortcutSelectedNotes(
              ctx.selectedNoteIds.size > 1 ? !ctx.allSelectedShortcuts : !ctx.isShortcut
            ),
        },
        {
          label: "Note Info",
          shortcut: "Ctrl/⌘ ⇧ I",
          disabled: !ctx.activeNote,
          onSelect: () => ctx.setShowInfo(true),
        },
        {
          label: "Rename Note…",
          disabled: !ctx.activeNote,
          onSelect: () => {
            if (!ctx.activeNote) return;
            ctx.openRename({
              kind: "note",
              id: ctx.activeNote.id,
              name: ctx.activeNote.title || "Untitled",
            });
          },
        },
        {
          label: "Copy Title",
          disabled: !ctx.activeNote,
          onSelect: () => ctx.copyNoteTitle(ctx.activeNote?.title),
        },
        {
          label: "Find in Note",
          shortcut: "Ctrl/⌘ F",
          disabled: !ctx.activeNote,
          onSelect: () => ctx.setFindTick((tick) => tick + 1),
        },
        {
          label: "Move to Notebook…",
          disabled: ctx.targetNoteIds().length === 0 || ctx.filter.type === "trash",
          onSelect: () => ctx.setNotebookPicker("move"),
        },
        {
          label: "Copy to Notebook…",
          disabled: ctx.targetNoteIds().length === 0 || ctx.filter.type === "trash",
          onSelect: () => ctx.setNotebookPicker("copy"),
        },
        {
          label: "Copy as",
          disabled: !ctx.activeNote,
          children: [
            {
              label: "Rich Text",
              disabled: !ctx.activeNote,
              onSelect: () => void ctx.copyActiveNoteAs("rich"),
            },
            {
              label: "Plain Text",
              disabled: !ctx.activeNote,
              onSelect: () => void ctx.copyActiveNoteAs("plain"),
            },
            {
              label: "Markdown",
              disabled: !ctx.activeNote,
              onSelect: () => void ctx.copyActiveNoteAs("markdown"),
            },
          ],
        },
        {
          label: "Export as Markdown…",
          disabled: ctx.targetNoteIds().length === 0,
          onSelect: () => void ctx.exportSelectedNotes("markdown"),
        },
        {
          label: "Export as PDF…",
          disabled: ctx.targetNoteIds().length === 0,
          onSelect: () => void ctx.exportSelectedNotes("pdf"),
        },
        {
          label: "Set Reminder",
          disabled: !ctx.activeNote,
          onSelect: () => ctx.setShowReminderMenu(true),
        },
        {
          label:
            ctx.activeNote && ctx.isReminderCompleted(ctx.activeNote.id)
              ? "Restore Reminder"
              : "Mark Reminder Done",
          disabled: !ctx.activeNote?.reminder_at,
          onSelect: () => ctx.toggleReminderDone(ctx.activeNote?.id),
        },
        {
          label: "Email Note…",
          disabled: !ctx.activeNote,
          onSelect: ctx.emailActiveNote,
        },
        {
          label: `Merge ${ctx.selectedNoteIds.size} Notes`,
          disabled: ctx.selectedNoteIds.size < 2,
          onSelect: () => void ctx.mergeSelectedNotes(),
        },
        {
          label:
            ctx.selectedNoteIds.size > 1
              ? ctx.allSelectedArchived
                ? `Unarchive ${ctx.selectedNoteIds.size} Notes`
                : `Archive ${ctx.selectedNoteIds.size} Notes`
              : ctx.activeNote?.is_archived
                ? "Unarchive Note"
                : "Archive Note",
          disabled: ctx.targetNoteIds().length === 0,
          onSelect: () => {
            void ctx.archiveSelectedNotes(
              ctx.selectedNoteIds.size > 1
                ? !ctx.allSelectedArchived
                : !ctx.activeNote?.is_archived
            );
          },
        },
        { type: "separator" },
        ...(ctx.filter.type === "trash"
          ? [
              {
                label:
                  ctx.selectedNoteIds.size > 1
                    ? `Restore ${ctx.selectedNoteIds.size} Notes`
                    : "Restore Note",
                disabled: ctx.targetNoteIds().length === 0,
                onSelect: () => void ctx.restoreSelectedNotes(),
              },
              {
                label:
                  ctx.selectedNoteIds.size > 1
                    ? `Delete ${ctx.selectedNoteIds.size} Notes Permanently`
                    : "Delete Note Permanently",
                disabled: ctx.targetNoteIds().length === 0,
                onSelect: () => void ctx.deleteSelectedNotes(),
              },
            ]
          : [
              {
                label:
                  ctx.selectedNoteIds.size > 1
                    ? `Move ${ctx.selectedNoteIds.size} Notes to Trash`
                    : "Move Note to Trash",
                disabled: ctx.targetNoteIds().length === 0,
                onSelect: () => void ctx.deleteSelectedNotes(),
              },
            ]),
      ],
    },
    {
      label: "Format",
      items: [
        {
          label: "Font",
          disabled: !ctx.activeNote,
          children: [
            { label: "Default", disabled: !ctx.activeNote, onSelect: () => runEditorCommand({ type: "fontFamily" }) },
            { label: "Sans Serif", disabled: !ctx.activeNote, onSelect: () => runEditorCommand({ type: "fontFamily", family: "Arial, sans-serif" }) },
            { label: "Serif", disabled: !ctx.activeNote, onSelect: () => runEditorCommand({ type: "fontFamily", family: "Georgia, \"Times New Roman\", serif" }) },
            { label: "Monospace", disabled: !ctx.activeNote, onSelect: () => runEditorCommand({ type: "fontFamily", family: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" }) },
            { type: "separator" },
            { label: "12", disabled: !ctx.activeNote, onSelect: () => runEditorCommand({ type: "fontSize", size: "12px" }) },
            { label: "16", disabled: !ctx.activeNote, onSelect: () => runEditorCommand({ type: "fontSize", size: "16px" }) },
            { label: "18", disabled: !ctx.activeNote, onSelect: () => runEditorCommand({ type: "fontSize", size: "18px" }) },
            { label: "24", disabled: !ctx.activeNote, onSelect: () => runEditorCommand({ type: "fontSize", size: "24px" }) },
            { label: "Reset Size", disabled: !ctx.activeNote, onSelect: () => runEditorCommand({ type: "fontSize" }) },
            { type: "separator" },
            { label: "Increase Size", disabled: !ctx.activeNote, onSelect: () => runEditorCommand({ type: "fontSizeStep", direction: 1 }) },
            { label: "Decrease Size", disabled: !ctx.activeNote, onSelect: () => runEditorCommand({ type: "fontSizeStep", direction: -1 }) },
          ],
        },
        { type: "separator" },
        {
          label: "Heading 1",
          disabled: !ctx.activeNote,
          onSelect: () => runEditorCommand({ type: "heading", level: 1 }),
        },
        {
          label: "Heading 2",
          disabled: !ctx.activeNote,
          onSelect: () => runEditorCommand({ type: "heading", level: 2 }),
        },
        {
          label: "Heading 3",
          disabled: !ctx.activeNote,
          onSelect: () => runEditorCommand({ type: "heading", level: 3 }),
        },
        { type: "separator" },
        {
          label: "Bold",
          shortcut: "Ctrl/⌘ B",
          disabled: !ctx.activeNote,
          onSelect: () => runEditorCommand({ type: "bold" }),
        },
        {
          label: "Italic",
          shortcut: "Ctrl/⌘ I",
          disabled: !ctx.activeNote,
          onSelect: () => runEditorCommand({ type: "italic" }),
        },
        {
          label: "Underline",
          shortcut: "Ctrl/⌘ U",
          disabled: !ctx.activeNote,
          onSelect: () => runEditorCommand({ type: "underline" }),
        },
        {
          label: "Strikethrough",
          disabled: !ctx.activeNote,
          onSelect: () => runEditorCommand({ type: "strike" }),
        },
        {
          label: "Superscript",
          disabled: !ctx.activeNote,
          onSelect: () => runEditorCommand({ type: "superscript" }),
        },
        {
          label: "Subscript",
          disabled: !ctx.activeNote,
          onSelect: () => runEditorCommand({ type: "subscript" }),
        },
        { type: "separator" },
        {
          label: "Highlight",
          disabled: !ctx.activeNote,
          children: [
            ...HIGHLIGHT_COLORS.map((swatch) => ({
              label: swatch.label,
              disabled: !ctx.activeNote,
              onSelect: () => runEditorCommand({ type: "highlight", color: swatch.color }),
            })),
            {
              label: "Remove Highlight",
              disabled: !ctx.activeNote,
              onSelect: () => runEditorCommand({ type: "highlight" }),
            },
          ],
        },
        {
          label: "Text Color",
          disabled: !ctx.activeNote,
          children: [
            ...TEXT_COLORS.filter((swatch) => swatch.color).map((swatch) => ({
              label: swatch.label,
              disabled: !ctx.activeNote,
              onSelect: () => runEditorCommand({ type: "color", color: swatch.color }),
            })),
            {
              label: "Remove Text Color",
              disabled: !ctx.activeNote,
              onSelect: () => runEditorCommand({ type: "color" }),
            },
          ],
        },
        { type: "separator" },
        {
          label: "Align",
          disabled: !ctx.activeNote,
          children: [
            {
              label: "Align Left",
              disabled: !ctx.activeNote,
              onSelect: () => runEditorCommand({ type: "align", align: "left" }),
            },
            {
              label: "Align Center",
              disabled: !ctx.activeNote,
              onSelect: () => runEditorCommand({ type: "align", align: "center" }),
            },
            {
              label: "Align Right",
              disabled: !ctx.activeNote,
              onSelect: () => runEditorCommand({ type: "align", align: "right" }),
            },
            {
              label: "Justify",
              disabled: !ctx.activeNote,
              onSelect: () => runEditorCommand({ type: "align", align: "justify" }),
            },
          ],
        },
        {
          label: "Increase Indent",
          shortcut: "Tab",
          disabled: !ctx.activeNote,
          onSelect: () => runEditorCommand({ type: "indent" }),
        },
        {
          label: "Decrease Indent",
          shortcut: "⇧ Tab",
          disabled: !ctx.activeNote,
          onSelect: () => runEditorCommand({ type: "outdent" }),
        },
        { type: "separator" },
        {
          label: "Table",
          disabled: !ctx.activeNote,
          children: [
            {
              label: "Insert Table",
              disabled: !ctx.activeNote,
              onSelect: () => runEditorCommand({ type: "insertTable" }),
            },
            {
              label: "Add Row Below",
              disabled: !ctx.activeNote,
              onSelect: () => runEditorCommand({ type: "tableAction", action: "addRow" }),
            },
            {
              label: "Add Column Right",
              disabled: !ctx.activeNote,
              onSelect: () => runEditorCommand({ type: "tableAction", action: "addColumn" }),
            },
            {
              label: "Delete Row",
              disabled: !ctx.activeNote,
              onSelect: () => runEditorCommand({ type: "tableAction", action: "deleteRow" }),
            },
            {
              label: "Delete Column",
              disabled: !ctx.activeNote,
              onSelect: () => runEditorCommand({ type: "tableAction", action: "deleteColumn" }),
            },
            {
              label: "Delete Table",
              disabled: !ctx.activeNote,
              onSelect: () => runEditorCommand({ type: "tableAction", action: "deleteTable" }),
            },
          ],
        },
        {
          label: "Insert Link…",
          disabled: !ctx.activeNote,
          onSelect: () => runEditorCommand({ type: "openLinkDialog" }),
        },
        {
          label: "Remove Link",
          disabled: !ctx.activeNote,
          onSelect: () => runEditorCommand({ type: "unlink" }),
        },
        {
          label: "Insert Table of Contents",
          disabled: !ctx.activeNote,
          onSelect: () => runEditorCommand({ type: "insertToc" }),
        },
        { type: "separator" },
        {
          label: "Bulleted List",
          shortcut: "Ctrl/⌘ ⇧ L",
          disabled: !ctx.activeNote,
          onSelect: () => runEditorCommand({ type: "bulletList" }),
        },
        {
          label: "Numbered List",
          shortcut: "Ctrl/⌘ ⇧ O",
          disabled: !ctx.activeNote,
          onSelect: () => runEditorCommand({ type: "orderedList" }),
        },
        {
          label: "Checklist",
          shortcut: "Ctrl/⌘ ⇧ C",
          disabled: !ctx.activeNote,
          onSelect: () => runEditorCommand({ type: "taskList" }),
        },
        {
          label: "Insert Checkbox",
          disabled: !ctx.activeNote,
          onSelect: () => runEditorCommand({ type: "inlineCheckbox" }),
        },
        { type: "separator" },
        {
          label: "Quote",
          disabled: !ctx.activeNote,
          onSelect: () => runEditorCommand({ type: "blockquote" }),
        },
        {
          label: "Callout",
          disabled: !ctx.activeNote,
          children: [
            {
              label: "Info",
              disabled: !ctx.activeNote,
              onSelect: () => runEditorCommand({ type: "callout", kind: "info" }),
            },
            {
              label: "Warning",
              disabled: !ctx.activeNote,
              onSelect: () => runEditorCommand({ type: "callout", kind: "warning" }),
            },
            {
              label: "Tip",
              disabled: !ctx.activeNote,
              onSelect: () => runEditorCommand({ type: "callout", kind: "tip" }),
            },
          ],
        },
        {
          label: "Code Block",
          disabled: !ctx.activeNote,
          onSelect: () => runEditorCommand({ type: "codeBlock" }),
        },
        {
          label: "Inline Code",
          disabled: !ctx.activeNote,
          onSelect: () => runEditorCommand({ type: "inlineCode" }),
        },
        {
          label: "Horizontal Rule",
          disabled: !ctx.activeNote,
          onSelect: () => runEditorCommand({ type: "horizontalRule" }),
        },
        {
          label: "Insert Date and Time",
          disabled: !ctx.activeNote,
          onSelect: () => runEditorCommand({ type: "insertDateTime" }),
        },
        {
          label: "Insert Date",
          disabled: !ctx.activeNote,
          onSelect: () => runEditorCommand({ type: "insertDate" }),
        },
        {
          label: "Insert Time",
          disabled: !ctx.activeNote,
          onSelect: () => runEditorCommand({ type: "insertTime" }),
        },
        { type: "separator" },
        {
          label: "Remove Formatting",
          disabled: !ctx.activeNote,
          onSelect: () => runEditorCommand({ type: "clear" }),
        },
      ],
    },
    {
      label: "Tools",
      items: [
        {
          label: "Import from Evernote…",
          onSelect: ctx.importNotes,
        },
        {
          label: "Restore Built-in Templates",
          onSelect: () => void ctx.restoreTemplates(),
        },
      ],
    },
    {
      label: "Help",
      items: [
        {
          label: "Keyboard Shortcuts",
          shortcut: "Ctrl/⌘ /",
          onSelect: () => ctx.openSettings("shortcuts"),
        },
        {
          label: "About Notebook",
          onSelect: () => ctx.openSettings("about"),
        },
      ],
    },
  ];
}
