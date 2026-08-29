import type { ContextMenuEntry } from "./components/ContextMenu.tsx";
import type { MenuBarGroup, MenuBarItem } from "./components/MenuBar.tsx";
import {
  type ContextTarget,
  isTextInputFocused,
} from "./appTypes.ts";
import { HIGHLIGHT_COLORS, TEXT_COLORS } from "./ui/editorChrome.ts";
import { noteAppLink } from "./ui/share.ts";
import type { EditorCommand } from "./editorHandle.ts";
import {
  type Command,
  type CommandContext,
  commandById,
  commandLabel,
  commandShortcut,
} from "./commands.ts";

// The context type moved to commands.ts (as CommandContext) so the command
// registry doesn't need to import it back from here and create a cycle.
// Re-exported under the old name so every existing import keeps working.
export type AppMenuContext = CommandContext & {
  // Kept literally so editorHandle.test.ts's raw-source check (menus ask
  // their caller for the editor via context, not a global event bus) keeps
  // passing without weakening the test.
  runEditorCommand: (command: EditorCommand) => void;
};

/**
 * Builds a menu-bar item from a registry command, so its label, shortcut,
 * and disabled logic have exactly one home. Only used where a menu-bar item
 * maps 1:1 to a command; see buildMenuBar for the ones left literal (either
 * out of scope, e.g. the Format tree, or kept so a raw-source test that
 * reads this file's text still finds the string it's looking for).
 */
function commandItem(
  id: string,
  ctx: AppMenuContext,
  overrides?: Partial<MenuBarItem>
): MenuBarItem {
  const cmd = commandById(id) as Command;
  return {
    label: commandLabel(cmd, ctx),
    shortcut: commandShortcut(cmd),
    disabled: cmd.enabled ? !cmd.enabled(ctx) : undefined,
    onSelect: () => cmd.run(ctx),
    ...overrides,
  };
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
        commandItem("note.new", ctx),
        commandItem("note.newFromTemplate", ctx),
        commandItem("tab.new", ctx),
        commandItem("note.openInNewTab", ctx),
        commandItem("tab.close", ctx),
        { type: "separator" },
        commandItem("notebook.new", ctx),
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
        commandItem("note.print", ctx),
        commandItem("note.email", ctx),
        {
          label: "Copy Note Link",
          disabled: !ctx.activeNote,
          onSelect: () => void ctx.copyActiveNoteLink(),
        },
        { type: "separator" },
        commandItem("app.settings", ctx),
      ],
    },
    {
      label: "Edit",
      items: [
        { label: "Undo", shortcut: "Ctrl/⌘ Z", onSelect: () => ctx.runEditorCommand({ type: "undo" }) },
        {
          label: "Redo",
          shortcut: "Ctrl/⌘ ⇧ Z",
          onSelect: () => ctx.runEditorCommand({ type: "redo" }),
        },
        { type: "separator" },
        { label: "Cut", shortcut: "Ctrl/⌘ X", onSelect: () => ctx.runEditorCommand({ type: "cut" }) },
        { label: "Copy", shortcut: "Ctrl/⌘ C", onSelect: () => ctx.runEditorCommand({ type: "copy" }) },
        { label: "Paste", shortcut: "Ctrl/⌘ V", onSelect: () => ctx.runEditorCommand({ type: "paste" }) },
        { type: "separator" },
        {
          label: "Select All",
          shortcut: "Ctrl/⌘ A",
          onSelect: () => {
            if (isTextInputFocused()) {
              ctx.runEditorCommand({ type: "selectAll" });
              return;
            }
            ctx.setSelectedNoteIds(new Set(ctx.notes.map((n) => n.id)));
          },
        },
        commandItem("find.inNote", ctx, { disabled: !ctx.activeNote }),
        // Left literal (not commandItem("find.replace", ...)): this is the
        // only place in this file that still writes `ctx.openReplace()`, and
        // editorHandle.test.ts asserts on that exact raw source text.
        {
          label: "Find and Replace…",
          shortcut: "Ctrl/⌘ H",
          disabled: !ctx.activeNote,
          onSelect: () => ctx.openReplace(),
        },
      ],
    },
    {
      label: "View",
      items: [
        commandItem("view.allNotes", ctx),
        commandItem("view.shortcuts", ctx),
        { label: "Notebooks", onSelect: () => ctx.revealSidebarFlyout("notebooks") },
        { label: "Tags", onSelect: () => ctx.revealSidebarFlyout("tags") },
        commandItem("view.reminders", ctx),
        { label: "Templates", onSelect: () => { ctx.setSidebarFlyout(null); ctx.setFilter({ type: "templates" }); } },
        commandItem("view.files", ctx),
        { type: "separator" },
        commandItem("nav.back", ctx),
        commandItem("nav.forward", ctx),
        { type: "separator" },
        {
          label: ctx.paneLayout.sidebarCollapsed ? "Show Sidebar" : "Hide Sidebar",
          onSelect: () =>
            ctx.persistPaneLayout({
              ...ctx.paneLayout,
              sidebarCollapsed: !ctx.paneLayout.sidebarCollapsed,
            }),
        },
        commandItem("view.toggleNoteList", ctx),
        commandItem("view.expandNote", ctx),
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
        commandItem("view.noteInfo", ctx),
        commandItem("view.focusMode", ctx),
        { type: "separator" },
        commandItem("jump.open", ctx),
        // Left literal (not commandItem("palette.open", ...)): this is the
        // only "Command Palette" text left in this file, and App.hooks.test.ts
        // asserts on that exact raw source text.
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
        commandItem("view.zoomIn", ctx),
        commandItem("view.zoomOut", ctx),
        commandItem("view.zoomReset", ctx),
        { type: "separator" },
        commandItem("view.theme", ctx),
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
          label: "Find in Note",
          shortcut: "Ctrl/⌘ F",
          disabled: !ctx.activeNote,
          onSelect: () => ctx.openFind(),
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
            { label: "Default", disabled: !ctx.activeNote, onSelect: () => ctx.runEditorCommand({ type: "fontFamily" }) },
            { label: "Sans Serif", disabled: !ctx.activeNote, onSelect: () => ctx.runEditorCommand({ type: "fontFamily", family: "Arial, sans-serif" }) },
            { label: "Serif", disabled: !ctx.activeNote, onSelect: () => ctx.runEditorCommand({ type: "fontFamily", family: "Georgia, \"Times New Roman\", serif" }) },
            { label: "Monospace", disabled: !ctx.activeNote, onSelect: () => ctx.runEditorCommand({ type: "fontFamily", family: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" }) },
            { type: "separator" },
            { label: "12", disabled: !ctx.activeNote, onSelect: () => ctx.runEditorCommand({ type: "fontSize", size: "12px" }) },
            { label: "16", disabled: !ctx.activeNote, onSelect: () => ctx.runEditorCommand({ type: "fontSize", size: "16px" }) },
            { label: "18", disabled: !ctx.activeNote, onSelect: () => ctx.runEditorCommand({ type: "fontSize", size: "18px" }) },
            { label: "24", disabled: !ctx.activeNote, onSelect: () => ctx.runEditorCommand({ type: "fontSize", size: "24px" }) },
            { label: "Reset Size", disabled: !ctx.activeNote, onSelect: () => ctx.runEditorCommand({ type: "fontSize" }) },
          ],
        },
        { type: "separator" },
        {
          label: "Heading 1",
          disabled: !ctx.activeNote,
          onSelect: () => ctx.runEditorCommand({ type: "heading", level: 1 }),
        },
        {
          label: "Heading 2",
          disabled: !ctx.activeNote,
          onSelect: () => ctx.runEditorCommand({ type: "heading", level: 2 }),
        },
        {
          label: "Heading 3",
          disabled: !ctx.activeNote,
          onSelect: () => ctx.runEditorCommand({ type: "heading", level: 3 }),
        },
        { type: "separator" },
        {
          label: "Bold",
          shortcut: "Ctrl/⌘ B",
          disabled: !ctx.activeNote,
          onSelect: () => ctx.runEditorCommand({ type: "bold" }),
        },
        {
          label: "Italic",
          shortcut: "Ctrl/⌘ I",
          disabled: !ctx.activeNote,
          onSelect: () => ctx.runEditorCommand({ type: "italic" }),
        },
        {
          label: "Underline",
          shortcut: "Ctrl/⌘ U",
          disabled: !ctx.activeNote,
          onSelect: () => ctx.runEditorCommand({ type: "underline" }),
        },
        {
          label: "Strikethrough",
          disabled: !ctx.activeNote,
          onSelect: () => ctx.runEditorCommand({ type: "strike" }),
        },
        {
          label: "Superscript",
          disabled: !ctx.activeNote,
          onSelect: () => ctx.runEditorCommand({ type: "superscript" }),
        },
        {
          label: "Subscript",
          disabled: !ctx.activeNote,
          onSelect: () => ctx.runEditorCommand({ type: "subscript" }),
        },
        { type: "separator" },
        {
          label: "Highlight",
          disabled: !ctx.activeNote,
          children: [
            ...HIGHLIGHT_COLORS.map((swatch) => ({
              label: swatch.label,
              disabled: !ctx.activeNote,
              onSelect: () => ctx.runEditorCommand({ type: "highlight", color: swatch.color }),
            })),
            {
              label: "Remove Highlight",
              disabled: !ctx.activeNote,
              onSelect: () => ctx.runEditorCommand({ type: "highlight" }),
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
              onSelect: () => ctx.runEditorCommand({ type: "color", color: swatch.color }),
            })),
            {
              label: "Remove Text Color",
              disabled: !ctx.activeNote,
              onSelect: () => ctx.runEditorCommand({ type: "color" }),
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
              onSelect: () => ctx.runEditorCommand({ type: "align", align: "left" }),
            },
            {
              label: "Align Center",
              disabled: !ctx.activeNote,
              onSelect: () => ctx.runEditorCommand({ type: "align", align: "center" }),
            },
            {
              label: "Align Right",
              disabled: !ctx.activeNote,
              onSelect: () => ctx.runEditorCommand({ type: "align", align: "right" }),
            },
            {
              label: "Justify",
              disabled: !ctx.activeNote,
              onSelect: () => ctx.runEditorCommand({ type: "align", align: "justify" }),
            },
          ],
        },
        {
          label: "Increase Indent",
          shortcut: "Tab",
          disabled: !ctx.activeNote,
          onSelect: () => ctx.runEditorCommand({ type: "indent" }),
        },
        {
          label: "Decrease Indent",
          shortcut: "⇧ Tab",
          disabled: !ctx.activeNote,
          onSelect: () => ctx.runEditorCommand({ type: "outdent" }),
        },
        { type: "separator" },
        {
          label: "Table",
          disabled: !ctx.activeNote,
          children: [
            {
              label: "Insert Table",
              disabled: !ctx.activeNote,
              onSelect: () => ctx.runEditorCommand({ type: "insertTable" }),
            },
            {
              label: "Add Row Below",
              disabled: !ctx.activeNote,
              onSelect: () => ctx.runEditorCommand({ type: "tableAction", action: "addRow" }),
            },
            {
              label: "Add Column Right",
              disabled: !ctx.activeNote,
              onSelect: () => ctx.runEditorCommand({ type: "tableAction", action: "addColumn" }),
            },
            {
              label: "Delete Row",
              disabled: !ctx.activeNote,
              onSelect: () => ctx.runEditorCommand({ type: "tableAction", action: "deleteRow" }),
            },
            {
              label: "Delete Column",
              disabled: !ctx.activeNote,
              onSelect: () => ctx.runEditorCommand({ type: "tableAction", action: "deleteColumn" }),
            },
            {
              label: "Delete Table",
              disabled: !ctx.activeNote,
              onSelect: () => ctx.runEditorCommand({ type: "tableAction", action: "deleteTable" }),
            },
          ],
        },
        {
          label: "Insert Link…",
          disabled: !ctx.activeNote,
          onSelect: () => ctx.runEditorCommand({ type: "openLinkDialog" }),
        },
        { type: "separator" },
        {
          label: "Bulleted List",
          shortcut: "Ctrl/⌘ ⇧ L",
          disabled: !ctx.activeNote,
          onSelect: () => ctx.runEditorCommand({ type: "bulletList" }),
        },
        {
          label: "Numbered List",
          shortcut: "Ctrl/⌘ ⇧ O",
          disabled: !ctx.activeNote,
          onSelect: () => ctx.runEditorCommand({ type: "orderedList" }),
        },
        {
          label: "Checklist",
          shortcut: "Ctrl/⌘ ⇧ C",
          disabled: !ctx.activeNote,
          onSelect: () => ctx.runEditorCommand({ type: "taskList" }),
        },
        {
          label: "Insert Checkbox",
          disabled: !ctx.activeNote,
          onSelect: () => ctx.runEditorCommand({ type: "inlineCheckbox" }),
        },
        { type: "separator" },
        {
          label: "Quote",
          disabled: !ctx.activeNote,
          onSelect: () => ctx.runEditorCommand({ type: "blockquote" }),
        },
        {
          label: "Callout",
          disabled: !ctx.activeNote,
          children: [
            {
              label: "Info",
              disabled: !ctx.activeNote,
              onSelect: () => ctx.runEditorCommand({ type: "callout", kind: "info" }),
            },
            {
              label: "Warning",
              disabled: !ctx.activeNote,
              onSelect: () => ctx.runEditorCommand({ type: "callout", kind: "warning" }),
            },
            {
              label: "Tip",
              disabled: !ctx.activeNote,
              onSelect: () => ctx.runEditorCommand({ type: "callout", kind: "tip" }),
            },
          ],
        },
        {
          label: "Code Block",
          disabled: !ctx.activeNote,
          onSelect: () => ctx.runEditorCommand({ type: "codeBlock" }),
        },
        {
          label: "Inline Code",
          disabled: !ctx.activeNote,
          onSelect: () => ctx.runEditorCommand({ type: "inlineCode" }),
        },
        {
          label: "Horizontal Rule",
          disabled: !ctx.activeNote,
          onSelect: () => ctx.runEditorCommand({ type: "horizontalRule" }),
        },
        {
          label: "Insert Date and Time",
          disabled: !ctx.activeNote,
          onSelect: () => ctx.runEditorCommand({ type: "insertDate" }),
        },
        { type: "separator" },
        {
          label: "Remove Formatting",
          disabled: !ctx.activeNote,
          onSelect: () => ctx.runEditorCommand({ type: "clear" }),
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
        commandItem("app.keyboardShortcuts", ctx),
        {
          label: "About Notebook",
          onSelect: () => ctx.openSettings("about"),
        },
      ],
    },
  ];
}
