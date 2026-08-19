import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildContextMenu,
  buildMenuBar,
  type AppMenuContext,
} from "./appMenus.ts";
import { defaultEditorChrome, defaultPaneLayout } from "./uiChrome.ts";

const noop = () => {};
const asyncNoop = async () => {};

function stubMenu(overrides: Partial<AppMenuContext> = {}): AppMenuContext {
  return {
    filter: { type: "all" },
    selectedNoteIds: new Set(),
    selectedNotes: [],
    shortcutIds: new Set(),
    stacks: [],
    notes: [],
    activeNote: null,
    activeTabId: "tab-1",
    paneLayout: defaultPaneLayout(),
    editorChrome: defaultEditorChrome(),
    prefs: {
      theme: "light",
      confirm_delete: true,
    } as AppMenuContext["prefs"],
    showInfo: false,
    focusMode: false,
    isShortcut: false,
    allSelectedPinned: false,
    allSelectedArchived: false,
    allSelectedShortcuts: false,
    targetNoteIds: () => [],
    createNote: noop,
    createBlankNote: noop,
    openNewStack: noop,
    openRename: noop,
    openSettings: noop,
    openNewTab: noop,
    openInNewTab: noop,
    closeTab: noop,
    loadNote: noop,
    setNewNotebookStackId: noop,
    setNewName: noop,
    setShowNewNotebook: noop,
    setShowNewTag: noop,
    setShowGallery: noop,
    setNotebookPicker: noop,
    setShowInfo: noop,
    setShowJump: noop,
    setFindTick: noop,
    setReplaceTick: noop,
    setFocusMode: noop,
    setFilter: noop,
    setSidebarFlyout: noop,
    setSelectedNoteIds: noop,
    setShowReminderMenu: noop,
    setPrefs: noop,
    setActiveNote: noop,
    persistPaneLayout: noop,
    persistEditorChrome: noop,
    revealSidebarFlyout: noop,
    restoreSelectedNotes: noop,
    deleteSelectedNotes: noop,
    shortcutSelectedNotes: noop,
    pinSelectedNotes: noop,
    duplicateSelectedNotes: noop,
    mergeSelectedNotes: noop,
    exportSelectedNotes: noop,
    archiveSelectedNotes: noop,
    updateNoteById: asyncNoop,
    refreshMeta: asyncNoop,
    refreshNotes: asyncNoop,
    confirm: async () => true,
    printActiveNote: noop,
    copyActiveNoteLink: noop,
    copyActiveNoteAs: noop,
    copyNoteTitle: noop,
    exportNotebook: noop,
    snoozeReminder: noop,
    searchInNotebook: noop,
    setListView: noop,
    importNotes: noop,
    setNotebookDefault: noop,
    setNotebookStack: noop,
    deleteNotebook: noop,
    deleteStack: noop,
    deleteTag: noop,
    restoreTemplates: noop,
    toggleTheme: noop,
    collapsedStacks: [],
    toggleStackCollapsed: noop,
    collapseAllStacks: noop,
    expandAllStacks: noop,
    canGoBack: false,
    canGoForward: false,
    goBack: noop,
    goForward: noop,
    emailActiveNote: noop,
    toggleReminderDone: noop,
    openCommandPalette: noop,
    isReminderCompleted: () => false,
    tags: [],
    addTagToSelected: noop,
    openJump: noop,
    reopenClosedTab: noop,
    canReopenClosedTab: false,
    recentNotes: [],
    closeAllTabs: noop,
    pinActiveTab: noop,
    isActiveTabPinned: false,
    openSelectedInTabs: noop,
    toggleNoteLocked: noop,
    isNoteLocked: false,
    setNoteColor: noop,
    noteColor: "",
    openShortcutsOverlay: noop,
    collapseAllListGroups: noop,
    expandAllListGroups: noop,
    canCollapseListGroups: false,
    ...overrides,
  };
}

function labels(items: { type?: string; label?: string }[]): string[] {
  return items
    .filter((item) => item.type !== "separator")
    .map((item) => item.label as string);
}

describe("buildMenuBar", () => {
  it("keeps import in File and Tools instead of the sidebar", () => {
    const groups = buildMenuBar(stubMenu());
    const file = groups.find((group) => group.label === "File");
    const tools = groups.find((group) => group.label === "Tools");
    assert.ok(file);
    assert.ok(tools);
    assert.equal(labels(file.items).includes("Import Notes…"), true);
    assert.equal(labels(tools.items).includes("Import from Evernote…"), true);
    assert.equal(
      groups.some((group) => labels(group.items).includes("Evernote (.enex)")),
      false
    );
  });

  it("pairs pin-sidebar and hide-attachments with the current chrome", () => {
    const groups = buildMenuBar(
      stubMenu({
        paneLayout: { ...defaultPaneLayout(), sidebarRail: true },
        editorChrome: { ...defaultEditorChrome(), attachmentsExpanded: true },
        activeNote: { id: "n1" } as AppMenuContext["activeNote"],
      })
    );
    const view = groups.find((group) => group.label === "View");
    assert.ok(view);
    const viewLabels = labels(view.items);
    assert.equal(viewLabels.includes("Pin Sidebar Open"), true);
    assert.equal(viewLabels.includes("Hide Attachments"), true);
    assert.equal(viewLabels.includes("Show Note Outline"), true);
    assert.equal(viewLabels.includes("Back"), true);
    assert.equal(viewLabels.includes("Forward"), true);
  });

  it("disables note actions when nothing is targeted", () => {
    const groups = buildMenuBar(stubMenu());
    const note = groups.find((group) => group.label === "Note");
    assert.ok(note);
    const pin = note.items.find(
      (item) => "label" in item && item.label === "Pin Note"
    );
    assert.ok(pin && "disabled" in pin);
    assert.equal(pin.disabled, true);
  });

  it("nests Format color, align, table, and font commands", () => {
    const groups = buildMenuBar(stubMenu());
    const format = groups.find((group) => group.label === "Format");
    assert.ok(format);
    const top = labels(format.items);
    assert.equal(top.includes("Highlight"), true);
    assert.equal(top.includes("Text Color"), true);
    assert.equal(top.includes("Align"), true);
    assert.equal(top.includes("Table"), true);
    assert.equal(top.includes("Font"), true);
    assert.equal(top.includes("Superscript"), true);
    assert.equal(top.includes("Subscript"), true);
    assert.equal(top.includes("Callout"), true);
    assert.equal(top.includes("Insert Date"), true);
    assert.equal(top.includes("Remove Link"), true);
    assert.equal(top.includes("Insert Table of Contents"), true);
    const align = format.items.find((item) => "label" in item && item.label === "Align");
    assert.ok(align && "children" in align && align.children);
    assert.equal(labels(align.children).includes("Justify"), true);
    const callout = format.items.find((item) => "label" in item && item.label === "Callout");
    assert.ok(callout && "children" in callout && callout.children);
    assert.equal(labels(callout.children).includes("Warning"), true);
  });
});

describe("buildContextMenu", () => {
  it("offers restore in trash and open-in-new-tab otherwise", () => {
    const note = {
      id: "n1",
      notebook_id: "nb",
      title: "Hello",
      snippet: "",
      is_pinned: false,
      is_archived: false,
      reminder_at: null,
      tag_ids: [],
      tag_names: [],
      attachment_count: 0,
      is_template: false,
      template_category: null,
      notebook_name: "First",
      created_at: "",
      updated_at: "",
    };
    const trash = buildContextMenu(
      { kind: "note", x: 0, y: 0, note },
      stubMenu({ filter: { type: "trash" } })
    );
    assert.equal(labels(trash).includes("Restore note"), true);
    assert.equal(labels(trash).includes("Open in New Tab"), false);

    const normal = buildContextMenu(
      { kind: "note", x: 0, y: 0, note },
      stubMenu()
    );
    assert.equal(labels(normal).includes("Open in New Tab"), true);
    assert.equal(labels(normal).includes("Move to trash"), true);
    assert.equal(labels(normal).includes("Export as Markdown"), true);
    assert.equal(labels(normal).includes("Copy as"), true);
  });

  it("exports a notebook and searches inside it from the notebook menu", () => {
    const notebook = {
      id: "nb1",
      user_id: "u",
      stack_id: null,
      name: "Work",
      is_default: false,
      sort_order: 0,
      created_at: "",
      updated_at: "",
      deleted_at: null,
    };
    const items = buildContextMenu(
      { kind: "notebook", x: 0, y: 0, notebook },
      stubMenu()
    );
    assert.equal(labels(items).includes("Search in this notebook"), true);
    assert.equal(labels(items).includes("Export notebook as Evernote XML"), true);
  });

  it("offers snooze when the note has a reminder", () => {
    const note = {
      id: "n1",
      notebook_id: "nb",
      title: "Hello",
      snippet: "",
      is_pinned: false,
      is_archived: false,
      reminder_at: "2026-08-18T18:00:00.000Z",
      tag_ids: [],
      tag_names: [],
      attachment_count: 0,
      is_template: false,
      template_category: null,
      notebook_name: "First",
      created_at: "",
      updated_at: "",
    };
    const items = buildContextMenu({ kind: "note", x: 0, y: 0, note }, stubMenu());
    const snooze = items.find((item) => "label" in item && item.label === "Snooze reminder");
    assert.ok(snooze && "children" in snooze && snooze.children);
    assert.equal(labels(snooze.children).includes("Later today"), true);
    assert.equal(labels(snooze.children).includes("Tomorrow morning"), true);
    assert.equal(labels(items).includes("Mark reminder done"), true);
    assert.equal(labels(items).includes("Email note…"), true);
  });

  it("lists command palette and email in the menu bar", () => {
    const groups = buildMenuBar(stubMenu({ activeNote: { id: "n1", reminder_at: "2026-08-18T18:00:00.000Z" } as AppMenuContext["activeNote"] }));
    const file = groups.find((group) => group.label === "File");
    const view = groups.find((group) => group.label === "View");
    const note = groups.find((group) => group.label === "Note");
    assert.ok(file && view && note);
    assert.equal(labels(file.items).includes("Email Note…"), true);
    assert.equal(labels(view.items).includes("Command Palette…"), true);
    assert.equal(labels(note.items).includes("Mark Reminder Done"), true);
  });
});
